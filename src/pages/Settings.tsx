import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import {
  Sun,
  Moon,
  Monitor,
  Download,
  Upload,
  Copy,
  Smartphone,
  LogOut,
  Plus,
  Trash2,
  Cloud,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { supabase, configured } from '../data/supabase';
import { downloadJson, dayKey } from '../domain/statistics';
import { validateBackup } from '../data/repository';
import { type Settings as SettingsType } from '../domain/types';
import { Modal, SectionTitle } from '../components/ui';
import { generationPrompt } from 'virtual:study-content';
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export function Settings({ exportResults }: { exportResults: () => void }) {
  const { data: d, demo, user, perform, busy, notify, leaveDemo } = useApp();
  const [subject, setSubject] = useState(''),
    [unit, setUnit] = useState(''),
    [unitSubject, setUnitSubject] = useState(''),
    [install, setInstall] = useState<InstallEvent | null>(null),
    [prompt, setPrompt] = useState(false),
    [restore, setRestore] = useState<ReturnType<typeof validateBackup> | null>(null),
    [deleteSubject, setDeleteSubject] = useState<{ subject: string; unit?: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  if (!d) return null;
  const setting = (value: Partial<SettingsType>) =>
    void perform((r) => r.saveSettings({ ...d.settings, ...value }));
  async function readBackup(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw Error('백업 파일은 50MB 이하여야 합니다.');
      const raw = JSON.parse(await file.text());
      if (raw.type !== 'chagok_backup' || raw.schema_version !== '1.0')
        throw Error('차곡 v1.0 백업 파일이 아닙니다.');
      setRestore(validateBackup(raw.data));
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      e.target.value = '';
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(generationPrompt);
      notify('문제 생성용 프롬프트를 복사했어요.');
    } catch {
      setPrompt(true);
    }
  }
  return (
    <div className="page settings-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR OWN STUDY ROUTINE</span>
          <h1>나에게 맞는 공부 환경</h1>
          <p>작은 습관부터 데이터까지, 내가 편한 방식으로 관리해요.</p>
        </div>
      </div>
      <section className="panel settings-section">
        <SectionTitle title="나의 계정" />
        <div className="account-row">
          <span className="avatar">{demo ? '체' : user?.email?.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{demo ? '체험 중인 학습자' : user?.email}</strong>
            <p>
              {demo ? (
                '이 브라우저에 저장되는 체험 데이터'
              ) : (
                <>
                  <Cloud size={13} />
                  Supabase에 안전하게 저장되는 나의 공부
                </>
              )}
            </p>
          </div>
          <button
            className="button secondary"
            onClick={() => {
              if (demo) leaveDemo();
              else
                void supabase?.auth.signOut().then(({ error }) => {
                  if (error) notify(error.message, true);
                });
            }}
          >
            <LogOut size={16} />
            {demo ? '로그인 화면' : '로그아웃'}
          </button>
        </div>
        {!configured && (
          <p className="notice">
            Supabase 연결 전입니다. .env.example을 참고해 공개 연결 정보를 설정하고 서버를 다시
            시작해 주세요.
          </p>
        )}
      </section>
      <section className="panel settings-section">
        <SectionTitle title="화면과 학습 설정" />
        <div className="setting-row">
          <div>
            <strong>화면 테마</strong>
            <p>편안하게 집중할 수 있는 화면을 골라요.</p>
          </div>
          <div className="segmented theme-picker">
            {(
              [
                { id: 'light', icon: Sun, label: '밝게' },
                { id: 'dark', icon: Moon, label: '어둡게' },
                { id: 'system', icon: Monitor, label: '시스템' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                className={d.settings.theme === t.id ? 'active' : ''}
                disabled={busy}
                onClick={() => setting({ theme: t.id })}
              >
                <t.icon size={16} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div>
            <strong>하루 목표 문제 수</strong>
            <p>매일 조금씩 달성할 수 있는 목표가 좋아요.</p>
          </div>
          <select
            aria-label="하루 목표 문제 수"
            value={d.settings.dailyGoal}
            disabled={busy}
            onChange={(e) => setting({ dailyGoal: Number(e.target.value) })}
          >
            {[
              5,
              10,
              20,
              30,
              50,
              100,
              ...([5, 10, 20, 30, 50, 100].includes(d.settings.dailyGoal)
                ? []
                : [d.settings.dailyGoal]),
            ].map((n) => (
              <option key={n} value={n}>
                {n}문제
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>복습 간격</strong>
            <p>변경한 방식은 다음 답안부터 적용돼요.</p>
          </div>
          <select
            aria-label="복습 간격"
            value={d.settings.reviewPace}
            disabled={busy}
            onChange={(e) => setting({ reviewPace: e.target.value as SettingsType['reviewPace'] })}
          >
            <option value="standard">기본 · 표준 간격</option>
            <option value="gentle">여유롭게 · 간격 1.3배</option>
            <option value="intensive">집중적으로 · 간격 0.7배</option>
          </select>
        </div>
        {(
          [
            {
              key: 'shuffleQuestions',
              title: '문제 순서 섞기',
              detail: '일반 학습의 문제 순서를 무작위로 바꿔요.',
            },
            {
              key: 'shuffleChoices',
              title: '객관식 선택지 섞기',
              detail: '정답의 위치 대신 내용을 기억하도록 도와줘요.',
            },
          ] as const
        ).map((o) => (
          <div className="setting-row" key={o.key}>
            <div>
              <strong>{o.title}</strong>
              <p>{o.detail}</p>
            </div>
            <button
              role="switch"
              aria-checked={d.settings[o.key]}
              aria-label={o.title}
              className={`toggle ${d.settings[o.key] ? 'on' : ''}`}
              disabled={busy}
              onClick={() => setting({ [o.key]: !d.settings[o.key] })}
            >
              <span />
            </button>
          </div>
        ))}
      </section>
      <section className="panel settings-section">
        <SectionTitle title="과목과 단원 관리" />
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(
              (r) => r.manageSubject('addSubject', subject.trim()),
              '과목을 추가했어요.',
            ).then((ok) => {
              if (ok) setSubject('');
            });
          }}
        >
          <input
            aria-label="새 과목 이름"
            placeholder="새 과목 이름"
            maxLength={200}
            value={subject}
            required
            onChange={(e) => setSubject(e.target.value)}
          />
          <button className="button secondary" disabled={busy || !subject.trim()}>
            <Plus size={16} />
            과목 추가
          </button>
        </form>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(
              (r) => r.manageSubject('addUnit', unitSubject, unit.trim()),
              '단원을 추가했어요.',
            ).then((ok) => {
              if (ok) setUnit('');
            });
          }}
        >
          <select
            aria-label="단원을 추가할 과목"
            value={unitSubject}
            required
            onChange={(e) => setUnitSubject(e.target.value)}
          >
            <option value="">과목 선택</option>
            {d.subjects.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
          <input
            aria-label="새 단원 이름"
            placeholder="새 단원 이름"
            maxLength={200}
            required
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
          <button className="button secondary" disabled={busy || !unit.trim() || !unitSubject}>
            <Plus size={16} />
            단원 추가
          </button>
        </form>
        <div className="subject-manager">
          {d.subjects.map((s) => (
            <div key={s.name}>
              <div className="managed-subject-heading">
                <strong>{s.name}</strong>
                <button
                  className="icon-button"
                  aria-label={`${s.name} 과목 삭제`}
                  onClick={() => setDeleteSubject({ subject: s.name })}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="unit-chips">
                {s.units.map((u) => (
                  <span key={u}>
                    {u}
                    <button
                      aria-label={`${u} 단원 삭제`}
                      onClick={() => setDeleteSubject({ subject: s.name, unit: u })}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="footnote">
          문제나 문제은행이 연결된 과목·단원은 기록 보호를 위해 삭제할 수 없어요.
        </p>
      </section>
      <section className="panel settings-section">
        <SectionTitle title="내 데이터와 ChatGPT Work" />
        <div className="data-actions">
          <button onClick={exportResults}>
            <Download size={21} />
            <div>
              <strong>학습 결과 내보내기</strong>
              <small>study_result · 취약 개념 분석용</small>
            </div>
            <span>↗</span>
          </button>
          <button
            onClick={() =>
              downloadJson(
                {
                  type: 'chagok_backup',
                  schema_version: '1.0',
                  created_at: new Date().toISOString(),
                  data: { ...d, entries: d.entries.map(({ dbId, ...e }) => e) },
                },
                `chagok_backup_${dayKey()}.json`,
              )
            }
          >
            <Download size={21} />
            <div>
              <strong>전체 데이터 백업</strong>
              <small>모든 문제 버전, 답안, 세션과 설정</small>
            </div>
            <span>↗</span>
          </button>
          <button onClick={() => fileInput.current?.click()}>
            <Upload size={21} />
            <div>
              <strong>백업 파일 복원</strong>
              <small>기존 기록과 병합 · 중복 제외</small>
            </div>
            <span>↗</span>
          </button>
          <button onClick={() => void copy()}>
            <Copy size={21} />
            <div>
              <strong>문제 생성용 프롬프트 복사</strong>
              <small>원본 자료와 JSON 스키마를 함께 첨부해요</small>
            </div>
            <span>↗</span>
          </button>
        </div>
        <input
          type="file"
          accept=".json,application/json"
          ref={fileInput}
          hidden
          onChange={(e) => void readBackup(e)}
        />
        <div className="schema-links">
          <a href={`${import.meta.env.BASE_URL}question-bank.schema.json`} download>
            문제 JSON 스키마
          </a>
          <a href={`${import.meta.env.BASE_URL}study-result.schema.json`} download>
            study_result 스키마
          </a>
          <a href={`${import.meta.env.BASE_URL}examples/biology.json`} download>
            문제 예제
          </a>
        </div>
      </section>
      <section className="panel settings-section">
        <div className="setting-row">
          <div>
            <strong>
              <Smartphone size={18} />홈 화면에 차곡 추가
            </strong>
            <p>앱처럼 열고, 매일 더 가볍게 공부하세요.</p>
          </div>
          {install && (
            <button
              className="button primary"
              onClick={() => void install.prompt().then(() => setInstall(null))}
            >
              앱 설치
            </button>
          )}
        </div>
        <p className="notice">
          iPhone: Safari의 공유 버튼 → 홈 화면에 추가
          <br />
          Android: Chrome 메뉴 → 앱 설치 또는 홈 화면에 추가
          <br />
          오프라인에서는 화면만 열 수 있어요. 계정 학습 기록을 저장하려면 인터넷 연결이 필요해요.
        </p>
        <p className="footnote">차곡 v1.0 · 웹앱은 OpenAI API를 호출하지 않습니다.</p>
      </section>
      {prompt && (
        <Modal title="문제 생성용 프롬프트" onClose={() => setPrompt(false)}>
          <textarea
            className="code-input"
            readOnly
            aria-label="문제 생성용 프롬프트"
            value={generationPrompt}
            onFocus={(e) => e.target.select()}
          />
        </Modal>
      )}
      {restore && (
        <Modal title="백업을 복원할까요?" onClose={() => setRestore(null)}>
          <p>
            문제 {restore.entries.length}개 · 풀이 기록 {restore.attempts.length}회
          </p>
          <p className="notice">
            기존 기록과 병합하고 중복은 제외합니다. 같은 문제 버전의 내용이 충돌하면 전체 복원을
            취소합니다. 화면 테마와 복습 설정도 백업 값으로 복원돼요.
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setRestore(null)}>
              취소
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void perform((r) => r.restore(restore), '백업을 복원했어요.').then((ok) => {
                  if (ok) setRestore(null);
                })
              }
            >
              복원하기
            </button>
          </div>
        </Modal>
      )}
      {deleteSubject && (
        <Modal
          title={`${deleteSubject.unit ? '단원' : '과목'}을 삭제할까요?`}
          onClose={() => setDeleteSubject(null)}
        >
          <p>
            {deleteSubject.subject}
            {deleteSubject.unit ? ` · ${deleteSubject.unit}` : ''}
          </p>
          <p className="notice">연결된 문제은행이 있으면 삭제되지 않습니다.</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDeleteSubject(null)}>
              취소
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void perform(
                  (r) =>
                    r.manageSubject(
                      deleteSubject.unit ? 'deleteUnit' : 'deleteSubject',
                      deleteSubject.subject,
                      deleteSubject.unit,
                    ),
                  '삭제했어요.',
                ).then((ok) => {
                  if (ok) setDeleteSubject(null);
                })
              }
            >
              삭제하기
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
