import { useEffect, useState } from 'react';
import { Copy, Link2, Unlink } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { supabase } from '../data/supabase';
import { SectionTitle } from './ui';

export const projectInstructions = `너는 차곡(내신 암기 학습 앱) 도우미야. 차곡 커넥터를 써서 아래처럼 도와줘.
- 내가 자료(사진·PDF·필기)를 주고 문제를 만들어 달라고 하면 get_question_format으로 규격을 확인하고, list_question_banks로 기존 문제은행을 본 뒤 import_question_bank로 바로 저장해 줘. 저장하기 전에 정답과 해설이 자료와 맞는지 스스로 검토해 줘.
- 과학처럼 수식·표·그래프·〈보기〉가 필요하면 schema_version "1.1"을 써 줘.
- 분석을 부탁하면 get_study_result로 학습 결과를 받아 취약 개념과 복습 순서를 정리하고, 원하면 취약 개념의 변형 문제를 만들어 저장해 줘.
- 저장한 뒤에는 추가·변경된 문제 수를 알려 줘.`;

type Status = { createdAt: string; lastUsedAt: string | null } | null;

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return (
    'chg_' +
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  );
}
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR');

/** 설정 화면의 Claude 연결(MCP 커넥터 주소) 관리. 계정 모드에서만 동작한다. */
export function ClaudeConnector() {
  const { demo, user, notify } = useApp();
  const [status, setStatus] = useState<Status | undefined>(undefined);
  const [url, setUrl] = useState('');
  const [working, setWorking] = useState(false);
  const online = !demo && !!user && !!supabase;

  useEffect(() => {
    if (!online) return;
    void supabase!.rpc('connector_status').then(({ data, error }) =>
      // 업데이트 SQL을 아직 실행하지 않은 DB라면 함수가 없다.
      setStatus(error ? null : ((data as Status) ?? null)),
    );
  }, [online]);

  async function run(action: () => Promise<void>) {
    setWorking(true);
    try {
      await action();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setWorking(false);
    }
  }
  const create = () =>
    run(async () => {
      if (status && !confirm('새 주소를 만들면 지금 연결된 주소는 바로 끊겨요. 계속할까요?'))
        return;
      const token = newToken();
      const { error } = await supabase!.rpc('set_connector_token', { p_token: token });
      if (error)
        throw Error(
          /connector|function/i.test(error.message)
            ? 'Supabase에 Claude 연결 SQL(supabase/claude-connector.sql)을 먼저 실행해 주세요.'
            : error.message,
        );
      setUrl(
        // 배포 변수 끝에 줄바꿈이 붙어 있어도 주소가 끊기지 않게 공백을 지운다.
        `${import.meta.env.VITE_SUPABASE_URL.trim().replace(/\/+$/, '')}/functions/v1/chagok-mcp/${token}`,
      );
      setStatus({ createdAt: new Date().toISOString(), lastUsedAt: null });
    });
  const revoke = () =>
    run(async () => {
      if (!confirm('연결을 끊으면 Claude가 더 이상 차곡에 접근하지 못해요. 끊을까요?')) return;
      const { error } = await supabase!.rpc('revoke_connector_token');
      if (error) throw Error(error.message);
      setUrl('');
      setStatus(null);
      notify('Claude 연결을 끊었어요.');
    });
  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(message);
    } catch {
      notify('복사하지 못했어요. 직접 선택해서 복사해 주세요.', true);
    }
  };

  return (
    <section className="panel settings-section connector">
      <SectionTitle
        title="Claude 연결"
        subtitle="Claude 대화에서 바로 문제를 저장하고 학습 통계를 불러와요."
      />
      {!online ? (
        <p className="connector-note">내 계정으로 로그인하면 Claude와 연결할 수 있어요.</p>
      ) : (
        <>
          <p className="connector-note">
            {status
              ? `연결 주소 사용 중 · ${when(status.createdAt)} 생성 · ${status.lastUsedAt ? `마지막 사용 ${when(status.lastUsedAt)}` : '아직 사용 전'}`
              : status === null
                ? '아직 연결 주소가 없어요.'
                : '연결 상태를 확인하는 중…'}
          </p>
          {url && (
            <div className="connector-url">
              <input
                readOnly
                value={url}
                aria-label="Claude 커넥터 주소"
                onFocus={(e) => e.target.select()}
              />
              <button
                className="button primary"
                onClick={() => void copy(url, '연결 주소를 복사했어요.')}
              >
                <Copy size={16} />
                복사
              </button>
              <p className="notice">
                이 주소는 지금만 보여요. 주소를 아는 사람은 내 문제은행을 읽고 문제를 추가할 수
                있으니 다른 사람과 공유하지 마세요. 잃어버리면 새 주소를 만들면 돼요.
              </p>
            </div>
          )}
          <div className="connector-actions">
            <button className="button secondary" disabled={working} onClick={() => void create()}>
              <Link2 size={16} />
              {status ? '새 연결 주소 만들기' : '연결 주소 만들기'}
            </button>
            {status && (
              <button className="button secondary" disabled={working} onClick={() => void revoke()}>
                <Unlink size={16} />
                연결 끊기
              </button>
            )}
          </div>
          <ol className="connector-steps">
            <li>연결 주소를 만들어 복사해요.</li>
            <li>
              claude.ai의 설정 → 커넥터에서 사용자 지정 커넥터를 추가하고, 이름은 "차곡", URL에는
              복사한 주소를 넣어요.
            </li>
            <li>
              Claude 프로젝트를 만들고 아래 지침을 프로젝트 지침에 붙여 넣어요. 그 프로젝트 대화에서
              차곡 커넥터를 켜면 돼요.
            </li>
          </ol>
          <button
            className="text-link"
            onClick={() => void copy(projectInstructions, '프로젝트 지침을 복사했어요.')}
          >
            프로젝트 지침 복사
          </button>
        </>
      )}
    </section>
  );
}
