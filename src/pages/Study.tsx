import { ManageCards } from '../components/ManageCards';
import { useState } from 'react';
import { BookOpen, RotateCcw, Timer, ArrowRight, Shuffle } from 'lucide-react';
import { Context, useApp } from '../state/AppContext';
import { createSession, filterQuestions, unsolvedInRound } from '../domain/study';
import { emptyFilters, type Filters, type StudyMode, modeLabels } from '../domain/types';
import { QuestionFilters } from '../components/QuestionFilters';
import { DemoRepository } from '../data/repository';
import { Player } from './Player';
import { Empty } from '../components/ui';
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
  const [temporary, setTemporary] = useState<DemoRepository | null>(null);
  const [snapshot, setSnapshot] = useState(d);
  const [sessionId, setSessionId] = useState('');
  const [mode, setMode] = useState<StudyMode>(initialReview ? 'review' : 'learn'),
    [filters, setFilters] = useState<Filters>({
      ...emptyFilters,
      subject: initialSubject,
      scope: initialReview ? 'due' : 'all',
    }),
    [count, setCount] = useState(10);
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
    modes = [
      { id: 'learn' as const, icon: BookOpen, description: '한 문제씩 확인하며 개념을 익혀요.' },
      { id: 'review' as const, icon: RotateCcw, description: '기억이 약한 문제부터 다시 만나요.' },
      { id: 'exam' as const, icon: Timer, description: '모두 푼 뒤 결과를 확인해요.' },
    ];
  async function start() {
    if (!d || !questions.length) return;
    const session = createSession(d, questions, mode, Math.min(count, questions.length));
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
          <span className="badge green">{questions.length}문제 선택 가능</span>
        </div>
        <QuestionFilters value={filters} onChange={setFilters} />
        <div className="study-options">
          <label>
            문제 수
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[5, 10, 20, 30, 50, 100, 2000].map((n) => (
                <option value={n} key={n}>
                  {n === 2000 ? '전체 문제' : `${n}문제`}
                </option>
              ))}
            </select>
          </label>
          <p>
            <Shuffle size={17} />
            {mode === 'exam'
              ? '문제는 무작위로 출제돼요.'
              : mode === 'review'
                ? '오답·복습 기한·숙련도를 함께 반영해요.'
                : '문제·선택지 섞기는 설정에서 변경할 수 있어요.'}
          </p>
        </div>
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
              <strong>{Math.min(count, questions.length)}문제</strong>
              <span>
                {' · '}
                {mode !== 'review' && unsolved < questions.length
                  ? `안 푼 문제 ${unsolved}개 우선 · `
                  : ''}
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
