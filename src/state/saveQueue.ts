// 학습 세션 저장을 한 줄로 세워 차례로 보낸다.
// 화면은 결과를 먼저 보여 주고(낙관적 업데이트) 저장은 뒤에서 하므로, 저장이 겹쳐도
// 순서가 섞이거나 세션 버전(revision)이 어긋나지 않게 여기서 맞춘다.
import type { Repository } from '../data/repository';
import {
  getQuestion,
  type AppData,
  type Attempt,
  type AttemptInput,
  type StudySession,
} from '../domain/types';
import { gradeAnswer } from '../domain/grading';

export interface QueuedRepository {
  repo: Repository;
  /** 아직 끝나지 않은 저장 수 */
  pending: () => number;
  /** 지금까지 넣은 저장이 모두 끝날 때까지 기다린다(실패해도 끝난 것으로 본다). */
  idle: () => Promise<void>;
}

export function queueSessionSaves(
  repo: Repository,
  onIdle: () => void = () => {},
): QueuedRepository {
  let tail: Promise<void> = Promise.resolve();
  let count = 0;
  // 세션별로 서버에 마지막으로 저장된 다음 revision. 화면 데이터가 아직 옛 값이어도 이 값을 쓴다.
  const revisions = new Map<string, number>();
  const commitSession = (session: StudySession, inputs: AttemptInput[] = []) => {
    count++;
    const job = tail.then(async () => {
      const revision = revisions.get(session.id) ?? session.revision;
      await repo.commitSession({ ...session, revision }, inputs);
      revisions.set(session.id, revision + 1);
    });
    tail = job.catch(() => {});
    return job.finally(() => {
      count--;
      if (!count) onIdle();
    });
  };
  const wrapped = new Proxy(repo, {
    get(target, prop, receiver) {
      if (prop === 'commitSession') return commitSession;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { repo: wrapped, pending: () => count, idle: () => tail };
}

/** 서버 저장 전에 화면에 바로 보여 줄 풀이 기록. 채점 규칙은 서버·체험 저장소와 같다. */
export function optimisticAttempt(
  d: AppData,
  session: StudySession,
  input: AttemptInput,
): Attempt | null {
  const q = getQuestion(d, { id: input.questionId, version: input.questionVersion });
  if (!q) return null;
  const previous = d.attempts.find(
    (a) => a.sessionId === session.id && a.questionId === q.id && a.questionVersion === q.version,
  );
  return {
    ...gradeAnswer(q, input.answer),
    id: previous?.id || input.id,
    sessionId: session.id,
    questionId: input.questionId,
    questionVersion: input.questionVersion,
    answer: input.answer,
    durationMs: input.durationMs,
    mode: session.mode,
    answeredAt: previous?.answeredAt || new Date().toISOString(),
    attemptNumber:
      previous?.attemptNumber || d.attempts.filter((a) => a.questionId === q.id).length + 1,
    manual: false,
    reviewPace: previous?.reviewPace || d.settings.reviewPace,
  };
}
