import { ManageCards } from '../components/ManageCards';
import { useState } from 'react';
import { BookOpen, RotateCcw, Timer, ArrowRight, Shuffle } from 'lucide-react';
import { Context, useApp } from '../state/AppContext';
import { createSession, filterQuestions, resetRounds, unsolvedInRound } from '../domain/study';
import { emptyFilters, type Filters, type StudyMode, modeLabels } from '../domain/types';
import { QuestionFilters } from '../components/QuestionFilters';
import { DemoRepository } from '../data/repository';
import { Player } from './Player';
import { Empty, Modal, NumberInput } from '../components/ui';
export function Study({
  initialSubject = '',
  initialReview = false,
  onStart,
  upload,
}: {
  initialSubject?: string;
  initialReview?: boolean;
  onStart: (id: string) => void;
  upload: () => void;
}) {
  const [active, setActive] = useState<string[]>([]),
    [completed, setCompleted] = useState<string[]>([]);
  const app = useApp();
  const { data: d, perform, busy } = app;
  const [practice, setPractice] = useState(false);
  const [unsolvedOnly, setUnsolvedOnly] = useState(true);
  const [temporary, setTemporary] = useState<DemoRepository | null>(null);
  const [snapshot, setSnapshot] = useState(d);
  const [sessionId, setSessionId] = useState('');
  const [mode, setMode] = useState<StudyMode>(initialReview ? 'review' : 'learn'),
    [filters, setFilters] = useState<Filters>({
      ...emptyFilters,
      subject: initialSubject,
      scope: initialReview ? 'due' : 'all',
    }),
    [count, setCount] = useState(10),
    [allQuestions, setAllQuestions] = useState(false),
    [resetting, setResetting] = useState(false);
  if (!d) return null;
  if (temporary && snapshot) {
    const refresh = async () => setSnapshot(await temporary.load());
    return (
      <Context.Provider
        value={{
          ...app,
          privateStudy: true,
          data: snapshot,
          repo: temporary,
          refresh,
          perform: async (action) => {
            try {
              await action(temporary);
              await refresh();
              return true;
            } catch (e) {
              app.notify(String(e), true);
              return false;
            }
          },
          advanceSession: async (session) => {
            await temporary.commitSession(session);
            await refresh();
            return true;
          },
        }}
      >
        <Player
          id={sessionId}
          onStart={setSessionId}
          onExit={() => {
            setTemporary(null);
            setSnapshot(null);
          }}
        />
      </Context.Provider>
    );
  }
  const questions = filterQuestions(d, filters),
    unsolved = unsolvedInRound(d, questions).length,
    onlyUnsolved = mode !== 'review' && unsolvedOnly,
    available = onlyUnsolved ? unsolved : questions.length,
    take = allQuestions ? available : Math.min(count, available),
    modes = [
      { id: 'learn' as const, icon: BookOpen, description: '한 문제씩 확인하며 개념을 익혀요.' },
      { id: 'review' as const, icon: RotateCcw, description: '기억이 약한 문제부터 다시 만나요.' },
      { id: 'exam' as const, icon: Timer, description: '모두 푼 뒤 결과를 확인해요.' },
    ];
  async function start() {
    if (!d || !questions.length) return;
    const session = createSession(d, questions, mode, take, {
      unsolvedOnly: onlyUnsolved,
    });
    if (practice) {
      const repo = new DemoRepository({ ...d, sessions: [], attempts: [], progress: [] });
      await repo.commitSession(session);
      setSnapshot(await repo.load());
      setSessionId(session.id);
      setTemporary(repo);
      return;
    }
    if (await perform((r) => r.commitSession(session))) onStart(session.id);
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h1>오늘은 어떻게 공부할까요?</h1>
          <p>나에게 맞는 방식으로, 원하는 범위만 골라 공부해요.</p>
        </div>
      </div>
      <div className="mode-grid">
        {modes.map((m) => (
          <button
            key={m.id}
            className={`mode-card ${mode === m.id ? 'selected' : ''}`}
            onClick={() => setMode(m.id)}
          >
            <span className="mode-icon">
              <m.icon size={25} />
            </span>
            <h3>{modeLabels[m.id]}</h3>
            <p>{m.description}</p>
            <span className="radio-indicator" />
          </button>
        ))}
      </div>
      <section className="panel study-config">
        <div className="section-heading">
          <h2>학습 범위 선택</h2>
          <span className="badge green">{available}문제 선택 가능</span>
        </div>
        <QuestionFilters value={filters} onChange={setFilters} />
        <div className="study-options">
          <div className="count-picker">
            <label>
              문제 수
              <select
                value={allQuestions ? 'all' : 'custom'}
                onChange={(e) => setAllQuestions(e.target.value === 'all')}
              >
                <option value="custom">사용자 지정</option>
                <option value="all">전체</option>
              </select>
            </label>
            {!allQuestions && (
              <NumberInput
                label="출제할 문제 수"
                value={count}
                min={1}
                max={2000}
                suffix="문제"
                onCommit={setCount}
              />
            )}
          </div>
          <p>
            <Shuffle size={17} />
            {mode === 'exam'
              ? '문제는 무작위로 출제돼요.'
              : mode === 'review'
                ? '오답·복습 기한·숙련도를 함께 반영해요.'
                : '문제·선택지 섞기는 설정에서 변경할 수 있어요.'}
          </p>
        </div>
        {mode !== 'review' && (
          <div className="unsolved-row">
            <label className="check-row">
              <input
                type="checkbox"
                checked={unsolvedOnly}
                onChange={(e) => setUnsolvedOnly(e.target.checked)}
              />
              이번 회차에 안 푼 문제만 · 끄면 푼 문제까지 섞어서 내요
            </label>
            <span className="unsolved-count">
              안 푼 문제 {unsolved} / {questions.length}
            </span>
            <button
              className="text-link"
              disabled={busy || !questions.length || unsolved === questions.length}
              onClick={() => setResetting(true)}
            >
              안 푼 문제 초기화
            </button>
          </div>
        )}
        {resetting && (
          <Modal title="안 푼 문제를 초기화할까요?" onClose={() => setResetting(false)}>
            <p>
              지금 고른 범위의 {questions.length}문제를 모두 <b>안 푼 문제</b>로 되돌려요. 이번
              회차에서 푼 {questions.length - unsolved}문제도 다시 출제돼요.
            </p>
            <p className="notice">
              풀이 기록, 정답률, 복습 일정은 그대로예요. 안 푼 문제를 세는 기준만 지금부터 새로
              시작해요.
            </p>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setResetting(false)}>
                취소
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void perform(
                    (r) => r.saveSettings(resetRounds(d, questions)),
                    '안 푼 문제를 초기화했어요.',
                  ).then((ok) => ok && setResetting(false))
                }
              >
                초기화
              </button>
            </div>
          </Modal>
        )}
        <label className="check-row">
          <input
            type="checkbox"
            checked={practice}
            onChange={(e) => setPractice(e.target.checked)}
          />
          무기록 학습 · 나가면 답안과 결과가 사라져요
        </label>
        {questions.length ? (
          <div className="start-strip">
            <div>
              <strong>{take}문제</strong>
              <span>
                {' · '}
                {onlyUnsolved && unsolved < questions.length ? '이번 회차 안 푼 문제만 · ' : ''}
                {modeLabels[mode]} 준비 완료
              </span>
            </div>
            <button className="button primary" disabled={busy} onClick={() => void start()}>
              {busy ? '준비 중…' : '학습 시작'}
              <ArrowRight size={18} />
            </button>
          </div>
        ) : (
          <Empty
            title="조건에 맞는 문제가 없어요"
            description="학습 범위를 바꾸거나 새 문제 파일을 가져와 주세요."
            action={
              <button className="button primary" onClick={upload}>
                문제 가져오기
              </button>
            }
          />
        )}
      </section>
      {(['active', 'completed'] as const).map((status) => (
        <ManageCards
          key={status}
          title={status === 'active' ? '이어서 학습하기' : '완료한 학습 기록'}
          items={d.sessions
            .filter((s) => s.status === status)
            .map((s) => ({
              id: s.id,
              title: modeLabels[s.mode],
              detail:
                new Date(s.startedAt).toLocaleString('ko-KR') +
                ' · ' +
                (status === 'active' ? Math.min(s.index + 1, s.queue.length) + ' / ' : '') +
                s.queue.length +
                '문제',
            }))}
          selected={status === 'active' ? active : completed}
          onSelect={status === 'active' ? setActive : setCompleted}
          onOpen={status === 'active' ? onStart : undefined}
          remove={(r, id) => r.deleteSession(id)}
          action="기록 삭제"
          warning="선택한 학습의 풀이 기록이 삭제되고 통계와 복습 일정에 반영됩니다."
        />
      ))}
    </div>
  );
}
