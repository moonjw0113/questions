import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  XCircle,
  Clock3,
  Flag,
  Star,
  Pause,
  Trophy,
  Layers,
  RotateCcw,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import {
  getQuestion,
  questionKey,
  typeLabels,
  modeLabels,
  type AttemptInput,
  type Question,
  type StudySession,
} from '../domain/types';
import { completedSentence, modelAnswers } from '../domain/grading';
import { percentage } from '../domain/statistics';
import { createSession } from '../domain/study';
import { Empty, Progress } from '../components/ui';
export function Player({
  id,
  onExit,
  onStart,
}: {
  id: string;
  onExit: () => void;
  onStart: (id: string) => void;
}) {
  const { data: d } = useApp();
  const session = d?.sessions.find((s) => s.id === id);
  if (!d || !session)
    return (
      <Empty
        title="학습 세션을 찾지 못했어요"
        description="학습 화면에서 다시 시작해 주세요."
        action={
          <button className="button primary" onClick={onExit}>
            학습으로 돌아가기
          </button>
        }
      />
    );
  if (session.status === 'completed')
    return <Results session={session} onExit={onExit} onStart={onStart} />;
  const q = getQuestion(d, session.queue[Math.min(session.index, session.queue.length - 1)]);
  if (!q)
    return (
      <Empty
        title="문제를 불러오지 못했어요"
        description="연결 상태를 확인하고 새로고침해 주세요."
      />
    );
  return <QuestionPlayer key={`${id}:${session.index}`} session={session} q={q} onExit={onExit} />;
}
function QuestionPlayer({
  session: s,
  q,
  onExit,
}: {
  session: StudySession;
  q: Question;
  onExit: () => void;
}) {
  const { data: d, perform, busy, demo } = useApp();
  const key = questionKey(q),
    saved = s.answers[key] || [];
  const autoSaved = useRef('');
  const [answer, setAnswer] = useState<string[]>(saved),
    [report, setReport] = useState(false),
    [reportText, setReportText] = useState('');
  const attempt = d!.attempts.find(
    (a) => a.sessionId === s.id && a.questionId === q.id && a.questionVersion === q.version,
  );
  const graded = s.mode !== 'exam' && Boolean(attempt);
  const clock = useRef({
    active: document.visibilityState === 'visible',
    last: performance.now(),
    elapsed: s.durations[key] || 0,
  });
  function elapsed() {
    const c = clock.current;
    const now = performance.now();
    if (c.active) c.elapsed += now - c.last;
    c.last = now;
    return Math.min(604800000, Math.round(c.elapsed));
  }
  useEffect(() => {
    const visibility = () => {
      elapsed();
      clock.current.active = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  const build = (value: string[] = answer): StudySession => ({
    ...s,
    answers: { ...s.answers, [key]: value },
    durations: { ...s.durations, [key]: elapsed() },
  });
  useEffect(() => {
    const signature = `${s.revision}:${JSON.stringify(answer)}`;
    if (
      graded ||
      busy ||
      JSON.stringify(saved) === JSON.stringify(answer) ||
      autoSaved.current === signature ||
      (!demo && !navigator.onLine)
    )
      return;
    const t = setTimeout(() => {
      autoSaved.current = signature;
      void perform((r) => r.commitSession(build()));
    }, 1100);
    return () => clearTimeout(t);
  }, [JSON.stringify(answer), s.revision, busy, graded]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(saved) !== JSON.stringify(answer)) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [JSON.stringify(saved), JSON.stringify(answer)]);
  async function submit(value = answer) {
    if (busy) return;
    const updated = build(value);
    setAnswer(value);
    const input: AttemptInput = {
      id: crypto.randomUUID(),
      questionId: q.id,
      questionVersion: q.version,
      answer: value,
      durationMs: updated.durations[key],
    };
    await perform((r) => r.commitSession(updated, [input]));
  }
  async function pause() {
    if (
      await perform(
        (r) => r.commitSession(build()),
        '학습 위치를 저장했어요. 언제든 이어서 공부할 수 있어요.',
      )
    )
      onExit();
  }
  async function next(direction = 1) {
    const next = build();
    next.index = s.index + direction;
    if (next.index >= s.queue.length) {
      next.status = 'completed';
      next.completedAt = new Date().toISOString();
      const inputs =
        s.mode === 'exam'
          ? s.queue.map((ref) => {
              const k = questionKey(ref);
              return {
                id: crypto.randomUUID(),
                questionId: ref.id,
                questionVersion: ref.version,
                answer: next.answers[k] || [],
                durationMs: next.durations[k] || 0,
              };
            })
          : [];
      await perform((r) => r.commitSession(next, inputs), '학습을 모두 마쳤어요. 수고했어요!');
    } else await perform((r) => r.commitSession(next));
  }
  async function correctManually() {
    if (!attempt) return;
    const input: AttemptInput = {
      id: attempt.id,
      questionId: q.id,
      questionVersion: q.version,
      answer: attempt.answer,
      durationMs: attempt.durationMs,
      manualScore: attempt.correct ? 0 : 1,
    };
    await perform((r) => r.commitSession(build(), [input]), '채점 결과와 복습 일정을 수정했어요.');
  }
  const choices =
    q.type === 'multiple_choice'
      ? (s.choiceOrders[key] || q.options.map((o) => o.id))
          .map((id) => q.options.find((o) => o.id === id)!)
          .filter(Boolean)
      : [];
  return (
    <div className="player-layout">
      <header className="player-header">
        <button
          className="icon-button"
          onClick={() => void pause()}
          disabled={busy}
          aria-label="저장 후 돌아가기"
        >
          <ArrowLeft size={22} />
        </button>
        <span className="brand compact">
          <Layers size={21} />
          차곡
        </span>
        <span className="player-mode">{modeLabels[s.mode]}</span>
        <button className="button ghost" disabled={busy} onClick={() => void pause()}>
          <Pause size={16} />
          잠시 쉬기
        </button>
      </header>
      <main className="player-main">
        <div className="player-progress-heading">
          <span>조금씩, 내 것으로 만드는 중</span>
          <strong>
            {s.index + 1}
            <span> / {s.queue.length}</span>
          </strong>
        </div>
        <Progress value={((s.index + (graded ? 1 : 0)) / s.queue.length) * 100} />
        <div className="question-toolbar">
          <span>
            {q.subject} <span className="muted">/</span> {q.unit}
          </span>
          <div>
            <button
              className={`icon-button ${d!.entries.find((e) => e.id === q.id)?.favorite ? 'favorited' : ''}`}
              aria-label="즐겨찾기"
              disabled={busy}
              onClick={() =>
                void perform((r) =>
                  r.updateQuestion(q.id, {
                    favorite: !d!.entries.find((e) => e.id === q.id)?.favorite,
                  }),
                )
              }
            >
              <Star size={19} />
            </button>
            <button
              className="icon-button"
              aria-label="문제 오류 표시"
              onClick={() => setReport(!report)}
            >
              <Flag size={18} />
            </button>
          </div>
        </div>
        {report && (
          <form
            className="report-form"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(
                (r) => r.updateQuestion(q.id, { report: reportText }),
                '문제에 오류 메모를 남겼어요.',
              ).then((ok) => {
                if (ok) setReport(false);
              });
            }}
          >
            <input
              aria-label="오류 메모"
              placeholder="오류 내용을 적어 주세요. 나의 문제에 메모로 저장돼요."
              value={reportText}
              required
              onChange={(e) => setReportText(e.target.value)}
            />
            <button className="button secondary" disabled={busy}>
              저장
            </button>
          </form>
        )}
        <section className="question-card">
          <div className="question-labels">
            <span className="badge green">{typeLabels[q.type]}</span>
            <span className="badge neutral">{['', '기본', '보통', '심화'][q.difficulty]}</span>
            <span className="question-topic">{q.topic}</span>
          </div>
          <span className="question-number">QUESTION {String(s.index + 1).padStart(2, '0')}</span>
          <h1>
            {q.type === 'fill_blank'
              ? q.content.split(/(\{\{\d+\}\})/g).map((p, i) =>
                  p.startsWith('{{') ? (
                    <span className="inline-blank" key={i}>
                      {p.replace(/[{}]/g, '')}
                    </span>
                  ) : (
                    p
                  ),
                )
              : q.content}
          </h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!graded && s.mode !== 'exam') void submit();
            }}
          >
            <div className="answer-area">
              {q.type === 'multiple_choice' ? (
                <div className="choices">
                  {choices.map((o, i) => {
                    const chosen = answer[0] === o.id;
                    const correct = graded && o.id === q.correctOptionId;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        disabled={graded || busy}
                        className={`choice ${chosen ? 'chosen' : ''} ${correct ? 'is-correct' : ''} ${graded && chosen && !correct ? 'is-wrong' : ''}`}
                        onClick={() => {
                          setAnswer([o.id]);
                          if (s.mode !== 'exam') void submit([o.id]);
                        }}
                      >
                        <span className="choice-letter">{String.fromCharCode(65 + i)}</span>
                        <span>{o.text}</span>
                        {correct ? (
                          <CheckCircle2 size={20} />
                        ) : graded && chosen ? (
                          <XCircle size={20} />
                        ) : (
                          <span className="choice-radio" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : q.type === 'short_answer' ? (
                <label className="answer-label">
                  나의 답안
                  <input
                    className="answer-input"
                    aria-label="단답형 답안"
                    placeholder="기억나는 답을 적어 보세요"
                    value={answer[0] || ''}
                    disabled={graded || busy}
                    autoComplete="off"
                    onChange={(e) => setAnswer([e.target.value])}
                  />
                </label>
              ) : (
                <div className="blank-inputs">
                  {q.blanks.map((b, i) => (
                    <label
                      key={b.id}
                      className={
                        graded ? (attempt!.blankResults[i] ? 'correct-blank' : 'wrong-blank') : ''
                      }
                    >
                      <span className="blank-index">{b.id}</span>
                      <input
                        aria-label={`${b.id}번 빈칸 답안`}
                        placeholder={`${b.id}번 빈칸의 답`}
                        value={answer[i] || ''}
                        disabled={graded || busy}
                        autoComplete="off"
                        onChange={(e) => {
                          const a = q.blanks.map((_, index) => answer[index] || '');
                          a[i] = e.target.value;
                          setAnswer(a);
                        }}
                      />
                      {graded &&
                        (attempt!.blankResults[i] ? (
                          <CheckCircle2 size={19} />
                        ) : (
                          <XCircle size={19} />
                        ))}
                    </label>
                  ))}
                </div>
              )}
            </div>
            {!graded && s.mode !== 'exam' && q.type !== 'multiple_choice' && (
              <button
                className="button primary full answer-submit"
                type="submit"
                disabled={busy || !answer.some((a) => a.trim())}
              >
                {busy ? '저장 중…' : '정답 확인'}
                <Check size={18} />
              </button>
            )}
          </form>
          {graded && attempt && (
            <div
              className={`feedback ${attempt.correct ? 'correct' : attempt.partial ? 'partial' : 'wrong'}`}
              role="status"
            >
              <div className="feedback-title">
                {attempt.correct ? <CheckCircle2 size={23} /> : <RotateCcw size={23} />}
                <h3>
                  {attempt.correct
                    ? '정답이에요! 차곡차곡 잘 쌓고 있어요.'
                    : attempt.partial
                      ? `부분 정답이에요. ${Math.round(attempt.score * 100)}% 맞혔어요.`
                      : '괜찮아요. 한 번 더 보면 기억에 남아요.'}
                </h3>
              </div>
              <span className="eyebrow">모범답안</span>
              <strong className="model-answer">{modelAnswers(q).join(' · ')}</strong>
              {q.type === 'fill_blank' && (
                <p className="completed-sentence">{completedSentence(q)}</p>
              )}
              <p>{q.explanation}</p>
              {q.type === 'short_answer' && (
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() => void correctManually()}
                >
                  {attempt.manual ? '수동 수정됨 · ' : ''}
                  {attempt.correct ? '오답으로 수정' : '내 답도 맞아요 · 정답으로 수정'}
                </button>
              )}
            </div>
          )}
          <div className="question-tags">
            {q.tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </div>
        </section>
        <div className="player-bottom">
          {s.mode === 'exam' ? (
            <>
              <button
                className="button secondary"
                disabled={busy || s.index === 0}
                onClick={() => void next(-1)}
              >
                <ArrowLeft size={17} />
                이전
              </button>
              <span>시험이 끝나면 정답과 해설을 확인할 수 있어요.</span>
              <button className="button primary" disabled={busy} onClick={() => void next()}>
                {busy ? '저장 중…' : s.index === s.queue.length - 1 ? '시험 제출하기' : '다음 문제'}
                <ArrowRight size={18} />
              </button>
            </>
          ) : graded ? (
            <>
              <span className="muted">
                <CheckCircle2 size={16} />
                학습 기록을 저장했어요
              </span>
              <button className="button primary" disabled={busy} onClick={() => void next()}>
                {s.index === s.queue.length - 1 ? '학습 마치기' : '다음 문제'}
                <ArrowRight size={18} />
              </button>
            </>
          ) : (
            <>
              <span className="muted">
                <Clock3 size={16} />
                천천히 생각해도 괜찮아요
              </span>
              <button
                className="text-link"
                disabled={busy}
                onClick={() => void submit(q.type === 'fill_blank' ? q.blanks.map(() => '') : [''])}
              >
                모르겠어요 · 정답 보기
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
function Results({
  session: s,
  onExit,
  onStart,
}: {
  session: StudySession;
  onExit: () => void;
  onStart: (id: string) => void;
}) {
  const { data: d, perform, busy } = useApp();
  const attempts = d!.attempts.filter((a) => a.sessionId === s.id);
  const accuracy = percentage(attempts.map((a) => a.score));
  async function retry() {
    const qs = attempts
      .filter((a) => a.score < 1)
      .map((a) =>
        getQuestion(d!, {
          id: a.questionId,
          version:
            d!.entries.find((e) => e.id === a.questionId)?.currentVersion || a.questionVersion,
        }),
      )
      .filter((q): q is Question => Boolean(q));
    const next = createSession(d!, qs, 'review', qs.length);
    if (await perform((r) => r.commitSession(next))) onStart(next.id);
  }
  return (
    <div className="page results-page">
      <div className="results-hero">
        <span className="trophy-icon">
          <Trophy size={38} />
        </span>
        <span className="eyebrow">ONE STEP CLOSER</span>
        <h1>오늘의 기억을 쌓았어요!</h1>
        <p>공부한 만큼, 어제보다 한 뼘 더 자랐어요.</p>
        <div className="results-metrics">
          <div>
            <strong>
              {accuracy}
              <small>%</small>
            </strong>
            <span>획득 점수 비율</span>
          </div>
          <div>
            <strong>
              {attempts.filter((a) => a.correct).length}
              <small> / {s.queue.length}</small>
            </strong>
            <span>완전 정답</span>
          </div>
          <div>
            <strong>
              {Math.max(1, Math.round(attempts.reduce((n, a) => n + a.durationMs, 0) / 60000))}
              <small>분</small>
            </strong>
            <span>학습 시간</span>
          </div>
        </div>
        <div className="results-actions">
          {attempts.some((a) => a.score < 1) && (
            <button className="button primary" disabled={busy} onClick={() => void retry()}>
              <RotateCcw size={18} />
              틀린 문제 다시 풀기
            </button>
          )}
          <button className="button secondary" onClick={onExit}>
            학습으로 돌아가기
          </button>
        </div>
      </div>
      <h2>문제별 돌아보기</h2>
      <div className="result-list">
        {s.queue.map((ref, i) => {
          const q = getQuestion(d!, ref)!,
            a = attempts.find((a) => a.questionId === ref.id && a.questionVersion === ref.version);
          return (
            <details className="panel result-item" key={questionKey(ref)}>
              <summary>
                <span
                  className={`result-status ${a?.correct ? 'green' : a?.partial ? 'orange' : 'red'}`}
                >
                  {a?.correct ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                </span>
                <span>
                  <small>
                    {i + 1}. {typeLabels[q.type]} · {q.topic}
                  </small>
                  <strong>{q.content}</strong>
                </span>
                <span className="badge neutral">{Math.round((a?.score || 0) * 100)}점</span>
              </summary>
              <div className="result-detail">
                <p>
                  <b>나의 답안</b>{' '}
                  {q.type === 'multiple_choice'
                    ? q.options.find((o) => o.id === a?.answer[0])?.text || '미입력'
                    : a?.answer.join(' · ') || '미입력'}
                </p>
                <p>
                  <b>모범답안</b> {modelAnswers(q).join(' · ')}
                </p>
                <p>{q.explanation}</p>
                {q.type === 'fill_blank' && <p>{completedSentence(q)}</p>}
                {q.type === 'short_answer' && a && (
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        (r) =>
                          r.commitSession(s, [
                            {
                              id: a.id,
                              questionId: q.id,
                              questionVersion: q.version,
                              answer: a.answer,
                              durationMs: a.durationMs,
                              manualScore: a.correct ? 0 : 1,
                            },
                          ]),
                        '채점 결과를 수정했어요.',
                      )
                    }
                  >
                    {a.manual ? '수동 채점 · ' : ''}
                    {a.correct ? '오답으로 수정' : '정답으로 수정'}
                  </button>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
