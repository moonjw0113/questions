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
import { type AppData, type Attempt, type AttemptInput, type StudySession } from '../domain/types';
import { DemoRepository, SupabaseRepository, type Repository } from '../data/repository';
import { optimisticAttempt, queueSessionSaves } from './saveQueue';
import { configured, supabase } from '../data/supabase';
interface AppContextValue {
  data: AppData | null;
  user: User | null;
  demo: boolean;
  loading: boolean;
  privateStudy?: boolean;
  busy: boolean;
  message: { text: string; error: boolean } | null;
  repo: Repository;
  perform: (action: (repo: Repository) => Promise<unknown>, success?: string) => Promise<boolean>;
  advanceSession: (session: StudySession, previous: StudySession) => Promise<boolean>;
  /** 답안 채점 결과를 바로 반영하고 저장은 뒤에서 한다. */
  recordAnswer: (session: StudySession, input: AttemptInput) => Promise<boolean>;
  refresh: () => Promise<void>;
  enterDemo: () => void;
  leaveDemo: () => void;
  notify: (text: string, error?: boolean) => void;
}
export const Context = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [demo, setDemo] = useState(!configured),
    [authReady, setAuthReady] = useState(!configured);
  const [data, setData] = useState<AppData | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<AppContextValue['message']>(null);
  const locked = useRef(false),
    generation = useRef(0),
    afterSaves = useRef<() => void>(() => {});
  const baseRepo = useMemo(
    () => (demo ? new DemoRepository() : new SupabaseRepository()),
    [demo, user?.id],
  );
  // 세션 저장은 모두 이 줄을 지나간다. 저장이 다 끝나면 서버 값(복습 일정 등)으로 한 번 맞춘다.
  const saves = useMemo(() => queueSessionSaves(baseRepo, () => afterSaves.current()), [baseRepo]);
  const repo = saves.repo;
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
  afterSaves.current = () => void refresh().catch(() => {});
  useEffect(() => {
    // 뒤에서 저장 중인데 창을 닫으려 하면 경고한다.
    const before = (e: BeforeUnloadEvent) => {
      if (saves.pending()) e.preventDefault();
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [saves]);
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
      if (!locked.current && !saves.pending() && navigator.onLine) refresh().catch(() => {});
    };
    const interval = setInterval(sync, 30000);
    window.addEventListener('focus', sync);
    window.addEventListener('online', sync);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', sync);
      window.removeEventListener('online', sync);
    };
  }, [Boolean(data), demo, refresh, saves]);
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
      // 화면은 바로 다음 문제로 넘기고, 저장은 줄을 서서 뒤에서 한다.
      generation.current++;
      setData(
        (current) =>
          current && {
            ...current,
            sessions: current.sessions.map((item) => (item.id === session.id ? session : item)),
          },
      );
      try {
        await repo.commitSession(session);
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
      }
    },
    [repo, notify],
  );
  const recordAnswer = useCallback(
    async (session: StudySession, input: AttemptInput) => {
      // 채점은 화면에서 바로 보여 주고(서버와 같은 규칙), 저장은 뒤에서 한다.
      generation.current++;
      const shown: Attempt | null = data ? optimisticAttempt(data, session, input) : null;
      setData(
        (current) =>
          current && {
            ...current,
            sessions: current.sessions.map((item) => (item.id === session.id ? session : item)),
            attempts: shown
              ? [...current.attempts.filter((a) => a.id !== shown.id), shown]
              : current.attempts,
          },
      );
      try {
        await repo.commitSession(session, [input]);
        return true;
      } catch (e) {
        generation.current++;
        setData(
          (current) =>
            current && {
              ...current,
              attempts: current.attempts.filter((a) => a !== shown),
            },
        );
        notify(
          `답안을 저장하지 못했어요. 다시 풀어 주세요. (${e instanceof Error ? e.message : String(e)})`,
          true,
        );
        return false;
      }
    },
    [repo, notify, data],
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
        recordAnswer,
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
