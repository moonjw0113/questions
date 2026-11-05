import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { type AppData, type StudySession } from '../domain/types';
import { DemoRepository, SupabaseRepository, type Repository } from '../data/repository';
import { configured, supabase } from '../data/supabase';
interface AppContextValue {
  data: AppData | null;
  user: User | null;
  demo: boolean;
  loading: boolean;
  busy: boolean;
  message: { text: string; error: boolean } | null;
  repo: Repository;
  perform: (action: (repo: Repository) => Promise<unknown>, success?: string) => Promise<boolean>;
  advanceSession: (session: StudySession, previous: StudySession) => Promise<boolean>;
  refresh: () => Promise<void>;
  enterDemo: () => void;
  leaveDemo: () => void;
  notify: (text: string, error?: boolean) => void;
}
const Context = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [demo, setDemo] = useState(!configured),
    [authReady, setAuthReady] = useState(!configured);
  const [data, setData] = useState<AppData | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<AppContextValue['message']>(null);
  const locked = useRef(false),
    generation = useRef(0);
  const repo = useMemo(
    () => (demo ? new DemoRepository() : new SupabaseRepository()),
    [demo, user?.id],
  );
  const notify = useCallback((text: string, error = false) => setMessage({ text, error }), []);
  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), message.error ? 12000 : 4500);
    return () => clearTimeout(t);
  }, [message]);
  const refresh = useCallback(async () => {
    const g = ++generation.current;
    const fresh = await repo.load();
    if (g === generation.current) setData(fresh);
  }, [repo]);
  useEffect(() => {
    setData(null);
    if (!authReady) return;
    if (!demo && !user) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    refresh()
      .catch((e) => {
        if (alive) notify(String(e.message), true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      generation.current++;
    };
  }, [refresh, authReady, demo, user?.id, notify]);
  useEffect(() => {
    if (!data || demo) return;
    const sync = () => {
      if (!locked.current && navigator.onLine) refresh().catch(() => {});
    };
    const interval = setInterval(sync, 30000);
    window.addEventListener('focus', sync);
    window.addEventListener('online', sync);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', sync);
      window.removeEventListener('online', sync);
    };
  }, [Boolean(data), demo, refresh]);
  const perform = useCallback(
    async (action: (r: Repository) => Promise<unknown>, success?: string) => {
      if (locked.current) return false;
      locked.current = true;
      setBusy(true);
      try {
        await action(repo);
        await refresh();
        if (success) notify(success);
        return true;
      } catch (e) {
        notify(
          e instanceof Error ? e.message : '작업을 완료하지 못했습니다. 다시 시도해 주세요.',
          true,
        );
        return false;
      } finally {
        locked.current = false;
        setBusy(false);
      }
    },
    [repo, refresh, notify],
  );
  const advanceSession = useCallback(
    async (session: StudySession, previous: StudySession) => {
      if (locked.current) return false;
      locked.current = true;
      generation.current++;
      setBusy(true);
      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          sessions: current.sessions.map((item) => (item.id === session.id ? session : item)),
        };
      });
      try {
        await repo.commitSession(session);
        setData(
          (current) =>
            current && {
              ...current,
              sessions: current.sessions.map((item) =>
                item.id === session.id
                  ? { ...item, revision: session.revision + 1, updatedAt: new Date().toISOString() }
                  : item,
              ),
            },
        );
        return true;
      } catch (e) {
        setData(
          (current) =>
            current && {
              ...current,
              sessions: current.sessions.map((item) => (item.id === session.id ? previous : item)),
            },
        );
        notify(
          e instanceof Error ? e.message : '진행 위치를 저장하지 못했습니다. 다시 시도해 주세요.',
          true,
        );
        return false;
      } finally {
        locked.current = false;
        setBusy(false);
      }
    },
    [repo, notify],
  );
  return (
    <Context.Provider
      value={{
        data,
        user,
        demo,
        loading,
        busy,
        message,
        repo,
        perform,
        advanceSession,
        refresh,
        enterDemo: () => setDemo(true),
        leaveDemo: () => setDemo(false),
        notify,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw Error('AppProvider is missing');
  return value;
}
