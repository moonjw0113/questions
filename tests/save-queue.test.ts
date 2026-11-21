import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { DemoRepository } from '../src/data/repository';
import { createSession, filterQuestions } from '../src/domain/study';
import { emptyFilters, type QuestionBank } from '../src/domain/types';
import { optimisticAttempt, queueSessionSaves } from '../src/state/saveQueue';

const example = JSON.parse(readFileSync('public/examples/biology.json', 'utf8')) as QuestionBank;

beforeEach(() => {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => map.get(k) || null,
      setItem: (k: string, v: string) => map.set(k, v),
    },
  });
});

async function setup() {
  const base = new DemoRepository();
  const bank = structuredClone(example);
  bank.bank.id = 'queue-bank';
  await base.importBank(bank);
  let idle = 0;
  const queued = queueSessionSaves(base, () => idle++);
  const d = await base.load();
  const questions = filterQuestions(d, emptyFilters).filter((q) => q.id.startsWith('queue-bank'));
  const session = createSession(d, questions, 'learn', 10, { unsolvedOnly: false });
  return { base, queued, d, session, idleCount: () => idle };
}

describe('세션 저장 대기열', () => {
  it('화면의 옛 revision으로 연달아 저장해도 순서대로, 버전을 맞춰 저장한다', async () => {
    const { base, queued, session, idleCount } = await setup();
    // 시작, 답안, 다음 문제를 기다리지 않고 한꺼번에 넣는다(모두 revision 0인 화면 값).
    const q = session.queue[0];
    const jobs = [
      queued.repo.commitSession(session),
      queued.repo.commitSession(session, [
        {
          id: crypto.randomUUID(),
          questionId: q.id,
          questionVersion: q.version,
          answer: ['x'],
          durationMs: 10,
        },
      ]),
      queued.repo.commitSession({ ...session, index: 1 }),
    ];
    expect(queued.pending()).toBe(3);
    await Promise.all(jobs);
    expect(queued.pending()).toBe(0);
    expect(idleCount()).toBe(1);
    const saved = (await base.load()).sessions.find((s) => s.id === session.id)!;
    expect(saved).toMatchObject({ index: 1, revision: 3 });
    expect((await base.load()).attempts.filter((a) => a.sessionId === session.id)).toHaveLength(1);
  });
  it('저장 하나가 실패해도 뒤 저장은 이어진다', async () => {
    const { base, queued, session } = await setup();
    await queued.repo.commitSession(session);
    const bad = queued.repo.commitSession(session, [
      {
        id: crypto.randomUUID(),
        questionId: 'none',
        questionVersion: 1,
        answer: [],
        durationMs: 0,
      },
    ]);
    const good = queued.repo.commitSession({ ...session, index: 2 });
    await expect(bad).rejects.toThrow('문제를 찾을 수 없습니다');
    await expect(good).resolves.toBeUndefined();
    expect((await base.load()).sessions.find((s) => s.id === session.id)!.index).toBe(2);
  });
  it('다른 저장소 기능은 그대로 쓸 수 있다', async () => {
    const { queued } = await setup();
    expect((await queued.repo.load()).banks.some((b) => b.id === 'queue-bank')).toBe(true);
  });
  it('미리 보여 주는 채점은 저장 뒤 채점과 같다', async () => {
    const { base, queued, d, session } = await setup();
    await queued.repo.commitSession(session);
    for (const [i, ref] of session.queue.entries()) {
      const q = d.versions.find((v) => v.question.id === ref.id)!.question;
      const answer =
        q.type === 'multiple_choice'
          ? [q.correctOptionId]
          : q.type === 'short_answer'
            ? [q.acceptedAnswers[0]]
            : q.blanks.map((b, j) => (j === 0 ? b.acceptedAnswers[0] : '틀림'));
      const input = {
        id: crypto.randomUUID(),
        questionId: q.id,
        questionVersion: q.version,
        answer,
        durationMs: 5,
      };
      const preview = optimisticAttempt(await base.load(), session, input)!;
      await queued.repo.commitSession({ ...session, index: i }, [input]);
      const stored = (await base.load()).attempts.find((a) => a.id === input.id)!;
      expect(preview).toMatchObject({
        score: stored.score,
        correct: stored.correct,
        partial: stored.partial,
        blankResults: stored.blankResults,
        attemptNumber: stored.attemptNumber,
        mode: stored.mode,
      });
    }
  });
});
