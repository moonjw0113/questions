import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  XCircle,
  Clock3,
  Flag,
  Menu,
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
  FLAG_DEFAULT,
  type AppData,
  type Attempt,
  type AttemptInput,
  type Question,
  type StudySession,
} from '../domain/types';
import {
  canAcceptManually,
  completedSentence,
  modelAnswers,
  withAcceptedAnswer,
} from '../domain/grading';
import { toBankFile } from '../domain/import';
import type { Repository } from '../data/repository';
import { percentage } from '../domain/statistics';
import { createSession } from '../domain/study';
import { readDraft, writeDraft } from '../domain/draft';
import { Empty, Progress } from '../components/ui';
import { RichText, Statements } from '../components/RichText';
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
  const {
    data: d,
    perform,
    advanceSession,
    recordAnswer,
    busy,
    demo,
    user,
    privateStudy,
  } = useApp();
  const key = questionKey(q),
    saved = s.answers[key] || [];
  const draftKey = `chagok-draft:${demo ? 'demo' : user?.id}:${s.id}:${key}`;
  const clearDraft = () => {
    if (privateStudy) return;
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* storage may be unavailable */
    }
  };
  const [answer, setAnswer] = useState<string[]>(() => {
      if (privateStudy) return saved;
      try {
        return readDraft(localStorage, draftKey, saved) || saved;
      } catch {
        /* use the server answer */
      }
      return saved;
    }),
    [report, setReport] = useState(false),
    [reportText, setReportText] = useState(''),
    [nav, setNav] = useState(false),
    [submitting, setSubmitting] = useState(false);
  const attempt = d!.attempts.find(
    (a) => a.sessionId === s.id && a.questionId === q.id && a.questionVersion === q.version,
  );
  const graded = s.mode !== 'exam' && Boolean(attempt);
  // 키보드로 풀기: 새 문제에서는 첫 입력칸에, 채점 뒤에는 '다음 문제' 버튼에 포커스를 둔다.
  // 그래서 답을 쓰고 Enter → 채점, 다시 Enter → 다음 문제로 마우스 없이 이어진다.
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // 휴대폰에서는 문제마다 키보드가 튀어나오지 않게, 마우스가 있는 기기에서만 입력칸에 바로 포커스한다.
    if (!graded && window.matchMedia?.('(pointer: fine)').matches)
      inputs.current[0]?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (graded && !busy) nextButton.current?.focus({ preventScroll: true });
  }, [graded, busy]);
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
    if (privateStudy) return;
    try {
      if (graded) localStorage.removeItem(draftKey);
      else writeDraft(localStorage, draftKey, saved, answer);
    } catch {
      /* the unload warning still protects an unsaved answer */
    }
  }, [draftKey, JSON.stringify(answer), JSON.stringify(saved), graded]);
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
    if (busy || graded || submitting) return;
    const updated = build(value);
    setAnswer(value);
    const input: AttemptInput = {
      id: crypto.randomUUID(),
      questionId: q.id,
      questionVersion: q.version,
      answer: value,
      durationMs: updated.durations[key],
    };
    // 채점 결과는 바로 보이고, 저장은 뒤에서 이어진다.
    setSubmitting(true);
    const ok = await recordAnswer(updated, input);
    if (ok) clearDraft();
    setSubmitting(false);
  }
  async function pause() {
    if (privateStudy) {
      onExit();
      return;
    }
    if (busy) return;
    setSubmitting(true);
    if (
      await perform(
        (r) => r.commitSession(build()),
        '학습 위치를 저장했어요. 언제든 이어서 공부할 수 있어요.',
      )
    ) {
      clearDraft();
      onExit();
    }
    setSubmitting(false);
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
      if (await perform((r) => r.commitSession(next, inputs), '학습을 모두 마쳤어요. 수고했어요!'))
        clearDraft();
    } else if (await advanceSession(next, s)) clearDraft();
  }
  /** 번호 목록에서 고른 문제로 바로 이동한다(푼 문제는 채점 결과와 함께 다시 볼 수 있다). */
  async function go(index: number) {
    setNav(false);
    if (index === s.index || index < 0 || index >= s.queue.length) return;
    const moved = build();
    moved.index = index;
    if (await advanceSession(moved, s)) clearDraft();
  }
  const entry = d!.entries.find((e) => e.id === q.id);
  const flagged = Boolean(entry?.report);
  const prevButton =
    s.index > 0 ? (
      <button
        className="button secondary prev-button"
        disabled={busy}
        aria-label="이전 문제"
        onClick={() => void next(-1)}
      >
        <ArrowLeft size={17} />
        이전
      </button>
    ) : null;
  /** 수정·삭제 예정 표시. 표시는 문제은행의 '표시한 문제'에 모이고, 메모를 남길 수 있다. */
  function toggleFlag() {
    if (flagged) {
      setReport(!report);
      return;
    }
    setReportText('');
    void perform(
      (r) => r.updateQuestion(q.id, { report: FLAG_DEFAULT }),
      '수정·삭제 예정으로 표시했어요. 문제은행에서 모아 볼 수 있어요.',
    ).then((ok) => ok && setReport(true));
  }
  async function correctManually() {
    if (!attempt) return;
    const change = manualCorrection(d!, build(), q, attempt, !privateStudy);
    await perform(change.run, change.message);
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
          {privateStudy ? '연습 종료' : '잠시 쉬기'}
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
          <span>{q.subject}</span>
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
              className={`icon-button ${flagged ? 'flagged' : ''}`}
              aria-label={flagged ? '수정·삭제 예정 표시됨 · 메모 보기' : '수정·삭제 예정으로 표시'}
              title={flagged ? '수정·삭제 예정 표시됨' : '수정·삭제 예정으로 표시'}
              disabled={busy}
              onClick={toggleFlag}
            >
              <Flag size={18} />
            </button>
            <button
              className={`icon-button ${nav ? 'active' : ''}`}
              aria-label="문제 번호 목록"
              aria-expanded={nav}
              title="문제 번호 목록"
              onClick={() => setNav(!nav)}
            >
              <Menu size={19} />
            </button>
          </div>
        </div>
        {nav && (
          <nav className="question-nav" aria-label="문제 번호로 이동">
            {s.queue.map((ref, i) => {
              const k = questionKey(ref);
              const done =
                s.mode === 'exam'
                  ? Boolean(s.answers[k]?.some((x) => x.trim()))
                  : d!.attempts.find(
                      (a) =>
                        a.sessionId === s.id &&
                        a.questionId === ref.id &&
                        a.questionVersion === ref.version,
                    );
              const state =
                done === undefined || done === false
                  ? ''
                  : done === true
                    ? 'answered'
                    : done.correct
                      ? 'correct'
                      : 'wrong';
              const mark = d!.entries.find((e) => e.id === ref.id)?.report;
              return (
                <button
                  key={k}
                  className={`nav-number ${state} ${i === s.index ? 'current' : ''} ${mark ? 'marked' : ''}`}
                  aria-current={i === s.index ? 'step' : undefined}
                  aria-label={`${i + 1}번 문제${state === 'correct' ? ' · 정답' : state === 'wrong' ? ' · 오답' : state ? ' · 답함' : ''}${mark ? ' · 수정·삭제 예정' : ''}`}
                  disabled={busy}
                  onClick={() => void go(i)}
                >
                  {i + 1}
                </button>
              );
            })}
          </nav>
        )}
        {report && flagged && (
          <form
            className="report-form"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(
                (r) => r.updateQuestion(q.id, { report: reportText.trim() || FLAG_DEFAULT }),
                '메모를 저장했어요.',
              ).then((ok) => {
                if (ok) setReport(false);
              });
            }}
          >
            <input
              aria-label="수정·삭제 메모"
              placeholder={
                entry?.report && entry.report !== FLAG_DEFAULT
                  ? entry.report
                  : '무엇을 고칠지 적어 두면 나중에 고칠 때 편해요(선택)'
              }
              value={reportText}
              onChange={(e) => setReportText(e.target.value)}
            />
            <button className="button secondary" disabled={busy}>
              메모 저장
            </button>
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() =>
                void perform(
                  (r) => r.updateQuestion(q.id, { report: '' }),
                  '수정·삭제 예정 표시를 해제했어요.',
                ).then((ok) => ok && setReport(false))
              }
            >
              표시 해제
            </button>
          </form>
        )}
        <section className="question-card">
          <div className="question-labels">
            <span className="badge green">{typeLabels[q.type]}</span>
            <span className="badge neutral">{['', '기본', '보통', '심화'][q.difficulty]}</span>
          </div>
          <span className="question-number">QUESTION {String(s.index + 1).padStart(2, '0')}</span>
          <RichText
            as="h1"
            text={q.content}
            rich={q.rich}
            blank={
              q.type === 'fill_blank'
                ? (id) => <span className="inline-blank">{id}</span>
                : undefined
            }
          />
          <Statements question={q} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!graded && s.mode !== 'exam') void submit();
              // 실전 시험은 채점이 없으니 Enter로 다음 문제로 간다(마지막 문제의 제출은 버튼으로만).
              else if (s.mode === 'exam' && s.index < s.queue.length - 1 && !busy) void next();
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
                        <RichText text={o.text} rich={q.rich} className="choice-text" />
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
                    disabled={graded || submitting}
                    autoComplete="off"
                    ref={(el) => {
                      inputs.current[0] = el;
                    }}
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
                        disabled={graded || submitting}
                        autoComplete="off"
                        ref={(el) => {
                          inputs.current[i] = el;
                        }}
                        onKeyDown={(e) => {
                          // 마지막 빈칸이 아니면 Enter로 다음 빈칸으로 옮긴다.
                          if (
                            e.key === 'Enter' &&
                            !e.nativeEvent.isComposing &&
                            i < q.blanks.length - 1
                          ) {
                            e.preventDefault();
                            inputs.current[i + 1]?.focus();
                          }
                        }}
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
              <RichText
                as="strong"
                className="model-answer"
                text={modelAnswers(q).join(' · ')}
                rich={q.rich}
              />
              {q.type === 'fill_blank' && (
                <RichText
                  as="p"
                  className="completed-sentence"
                  text={completedSentence(q)}
                  rich={q.rich}
                />
              )}
              <RichText as="p" text={q.explanation} rich={q.rich} />
              {canAcceptManually(q) &&
                (attempt.correct ? (
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() => void correctManually()}
                  >
                    {attempt.manual ? '정답으로 처리함 · 오답으로 되돌리기' : '오답으로 수정'}
                  </button>
                ) : (
                  <button
                    className="button secondary accept-answer"
                    disabled={busy}
                    onClick={() => void correctManually()}
                  >
                    <CheckCircle2 size={16} />
                    {privateStudy
                      ? '내 답도 맞아요 · 정답으로 처리'
                      : '내 답도 맞아요 · 정답 처리하고 정답 목록에 추가'}
                  </button>
                ))}
            </div>
          )}
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
              {prevButton}
              <span className="muted">
                <CheckCircle2 size={16} />
                {privateStudy ? '무기록 학습' : '학습 기록을 저장했어요'}
              </span>
              <button
                ref={nextButton}
                className="button primary"
                disabled={busy}
                onClick={() => void next()}
              >
                {s.index === s.queue.length - 1 ? '학습 마치기' : '다음 문제'}
                <kbd className="key-hint">Enter</kbd>
                <ArrowRight size={18} />
              </button>
            </>
          ) : (
            <>
              {prevButton}
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
  const { data: d, perform, busy, privateStudy } = useApp();
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
                  <RichText as="strong" text={q.content} rich={q.rich} />
                </span>
                <span className="badge neutral">{Math.round((a?.score || 0) * 100)}점</span>
              </summary>
              <div className="result-detail">
                <Statements question={q} />
                <p>
                  <b>나의 답안</b>{' '}
                  {q.type === 'multiple_choice' ? (
                    <RichText
                      text={q.options.find((o) => o.id === a?.answer[0])?.text || '미입력'}
                      rich={q.rich}
                    />
                  ) : (
                    a?.answer.join(' · ') || '미입력'
                  )}
                </p>
                <p>
                  <b>모범답안</b> <RichText text={modelAnswers(q).join(' · ')} rich={q.rich} />
                </p>
                <RichText as="p" text={q.explanation} rich={q.rich} />
                {q.type === 'fill_blank' && (
                  <RichText as="p" text={completedSentence(q)} rich={q.rich} />
                )}
                {canAcceptManually(q) && a && (
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() => {
                      const change = manualCorrection(d!, s, q, a, !privateStudy);
                      void perform(change.run, change.message);
                    }}
                  >
                    {a.correct
                      ? a.manual
                        ? '정답으로 처리함 · 오답으로 되돌리기'
                        : '오답으로 수정'
                      : privateStudy
                        ? '내 답도 맞아요 · 정답으로 처리'
                        : '내 답도 맞아요 · 정답 처리하고 정답 목록에 추가'}
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

/**
 * 수동 채점. 틀린 답을 정답으로 처리하면 그 답(틀린 빈칸의 답)을 문제의 정답 목록에도 더해
 * 다음부터는 자동으로 맞게 한다(새 내부 버전, 이전 풀이 기록은 유지). 정답 처리한 것은
 * 오답으로 되돌릴 수 있지만, 이미 더한 정답 목록은 그대로 둔다.
 */
function manualCorrection(
  d: AppData,
  session: StudySession,
  q: Question,
  a: Attempt,
  saveAnswer: boolean,
) {
  const accept = !a.correct;
  const input: AttemptInput = {
    id: a.id,
    questionId: q.id,
    questionVersion: q.version,
    answer: a.answer,
    durationMs: a.durationMs,
    manualScore: accept ? 1 : 0,
  };
  const entry = d.entries.find((e) => e.id === q.id);
  const bank = d.banks.find((b) => b.id === entry?.bankId);
  // 그사이 문제를 고쳤을 수 있으니 최신 버전에 정답을 더한다.
  const latest = (entry && getQuestion(d, { id: q.id, version: entry.currentVersion })) || q;
  const updated = accept && saveAnswer && bank ? withAcceptedAnswer(latest, a.answer) : null;
  return {
    run: async (r: Repository) => {
      await r.commitSession(session, [input]);
      if (updated && bank) await r.importBank(toBankFile(bank, [updated]));
    },
    message: !accept
      ? '오답으로 되돌렸어요.'
      : updated
        ? '정답으로 처리하고, 내 답을 정답 목록에 추가했어요.'
        : '정답으로 처리했어요.',
  };
}
