import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../data/supabase';
import { useApp } from '../state/AppContext';

type SharedBank = { id: string; title: string; subject: string; unit: string; count: number };

export function SharedBanks() {
  const { data, demo, user, perform, notify, busy } = useApp();
  const [admin, setAdmin] = useState(false);
  const [items, setItems] = useState<SharedBank[]>([]);
  const [bank, setBank] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const reload = useCallback(async () => {
    if (!supabase || demo || !user) return;
    const [a, b] = await Promise.all([
      supabase.rpc('study_is_admin'),
      supabase.rpc('list_shared_study_banks'),
    ]);
    if (a.error || b.error)
      throw new Error(
        '문제 공유 기능을 사용할 수 없습니다. 관리자에게 데이터베이스 설정을 확인해 달라고 요청하세요.',
      );
    setAdmin(Boolean(a.data));
    setItems((b.data || []) as SharedBank[]);
  }, [demo, user?.id]);

  useEffect(() => {
    if (demo || !user) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    reload()
      .then(() => {
        if (alive) setError('');
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reload, demo, user?.id]);

  if (demo || !user || !data) return null;
  async function send() {
    if (!supabase || !bank || !email.trim()) return;
    setSending(true);
    try {
      const { error: e } = await supabase.rpc('share_study_bank', {
        p_bank_id: bank,
        p_email: email.trim(),
      });
      if (e) notify(e.message, true);
      else {
        notify('문제은행을 보냈어요. 상대방이 문제은행 화면에서 받을 수 있습니다.');
        setEmail('');
      }
    } catch (e) {
      notify(
        e instanceof Error ? e.message : '문제를 보내지 못했습니다. 다시 시도해 주세요.',
        true,
      );
    } finally {
      setSending(false);
    }
  }
  async function receive(id: string) {
    if (!supabase) return;
    const ok = await perform(async () => {
      const { data: result, error: e } = await supabase!.rpc('receive_shared_study_bank', {
        p_id: id,
      });
      if (e) throw e;
      notify(
        `새 문제 ${result.added}개 · 새 버전 ${result.updated}개 · 중복 제외 ${result.skipped}개`,
      );
    });
    if (ok) await reload().catch((e) => setError(e.message));
  }
  return (
    <section className="panel bank-content" style={{ marginBottom: '1rem' }}>
      <h2>문제 공유</h2>
      {loading ? (
        <p>받은 문제를 확인하고 있어요…</p>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : (
        <>
          {items.length ? (
            items.map((item) => (
              <div key={item.id} className="notice">
                <strong>{item.title}</strong>
                <p>
                  {item.subject} · {item.unit} · {item.count}문제
                </p>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void receive(item.id)}
                >
                  문제 받기
                </button>
              </div>
            ))
          ) : (
            <p className="muted">받은 문제은행이 없어요.</p>
          )}
          {admin && (
            <div className="notice">
              <strong>관리자 · 문제은행 보내기</strong>
              <p>이메일 인증을 완료한 가입자에게 현재 문제은행을 보냅니다.</p>
              <label>
                문제은행 선택
                <br />
                <select
                  className="sharing-input"
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                >
                  <option value="">선택해 주세요</option>
                  {data.banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title} · {b.subject} · {b.unit}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                <label>
                  받는 사람 이메일
                  <br />
                  <input
                    className="sharing-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="student@example.com"
                  />
                </label>
              </p>
              <button
                className="button primary"
                disabled={busy || sending || !bank || !email.trim()}
                onClick={() => void send()}
              >
                {sending ? '보내는 중…' : '문제 보내기'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
