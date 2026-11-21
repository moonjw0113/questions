import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { DemoRepository } from '../src/data/repository';
import { gradeAnswer, manualGrade, withAcceptedAnswer } from '../src/domain/grading';
import { normalizeBank, toBankFile } from '../src/domain/import';
import { createSession, filterQuestions } from '../src/domain/study';
import { emptyFilters, getQuestion, type Question, type QuestionBank } from '../src/domain/types';

const example = JSON.parse(readFileSync('public/examples/biology.json', 'utf8')) as QuestionBank;
const questions = normalizeBank(example).questions;
const short = questions.find((q) => q.type === 'short_answer')!;
const blank = questions.find((q) => q.type === 'fill_blank')! as Extract<
  Question,
  { type: 'fill_blank' }
>;

describe('비슷한 답을 정답으로 처리', () => {
  it('단답형은 내 답을 정답 목록에 더하고, 이미 인정되는 답·빈 답은 더하지 않는다', () => {
    const updated = withAcceptedAnswer(short, [' 내 표현 ']);
    expect(updated?.type === 'short_answer' && updated.acceptedAnswers).toEqual([
      ...(short.type === 'short_answer' ? short.acceptedAnswers : []),
      '내 표현',
    ]);
    expect(gradeAnswer(updated!, ['내 표현']).correct).toBe(true);
    const same = short.type === 'short_answer' ? short.acceptedAnswers[0] : '';
    expect(withAcceptedAnswer(short, [` ${same.toUpperCase()} `])).toBeNull();
    expect(withAcceptedAnswer(short, ['  '])).toBeNull();
  });
  it('빈칸은 틀린 빈칸의 답만 그 빈칸 정답 목록에 더한다', () => {
    const answer = blank.blanks.map((b, i) => (i === 0 ? b.acceptedAnswers[0] : '비슷한 답'));
    const updated = withAcceptedAnswer(blank, answer) as typeof blank;
    expect(updated.blanks[0]).toBe(blank.blanks[0]);
    expect(updated.blanks.slice(1).every((b) => b.acceptedAnswers.includes('비슷한 답'))).toBe(
      true,
    );
    expect(gradeAnswer(updated, answer).correct).toBe(true);
  });
  it('수동 채점은 빈칸 수만큼 결과를 채운다', () => {
    expect(manualGrade(blank, 1)).toEqual({
      score: 1,
      correct: true,
      partial: false,
      blankResults: blank.blanks.map(() => true),
    });
    expect(manualGrade(short, 0).blankResults).toEqual([false]);
  });
});

describe('체험 저장소에서 정답 처리 흐름', () => {
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
  it('빈칸 문제를 정답 처리하고 정답 목록에 더하면 다음부터 자동으로 맞다', async () => {
    const repo = new DemoRepository();
    const bank = structuredClone(example);
    bank.bank.id = 'accept-bank';
    await repo.importBank(bank);
    let d = await repo.load();
    const q = filterQuestions(d, emptyFilters).find(
      (x) => x.id.startsWith('accept-bank') && x.type === 'fill_blank',
    ) as typeof blank;
    const session = createSession(d, [q], 'learn', 1);
    const answer = q.blanks.map(() => '비슷한 답');
    const id = crypto.randomUUID();
    const key = `${q.id}@${q.version}`;
    const answered = { ...session, answers: { [key]: answer } };
    await repo.commitSession(answered, [
      { id, questionId: q.id, questionVersion: q.version, answer, durationMs: 5 },
    ]);
    d = await repo.load();
    expect(d.attempts.find((a) => a.id === id)?.correct).toBe(false);
    // 정답 처리 + 정답 목록 추가 (Player의 manualCorrection과 같은 두 단계)
    await repo.commitSession({ ...answered, revision: 1 }, [
      { id, questionId: q.id, questionVersion: q.version, answer, durationMs: 5, manualScore: 1 },
    ]);
    await repo.importBank(
      toBankFile(
        d.banks.find((b) => b.id === 'accept-bank')!,
        [withAcceptedAnswer(q, answer)!],
      ),
    );
    d = await repo.load();
    expect(d.attempts.find((a) => a.id === id)).toMatchObject({
      manual: true,
      correct: true,
      blankResults: q.blanks.map(() => true),
    });
    const entry = d.entries.find((e) => e.id === q.id)!;
    expect(entry.currentVersion).toBe(q.version + 1);
    const latest = getQuestion(d, { id: q.id, version: entry.currentVersion })!;
    expect(gradeAnswer(latest, answer).correct).toBe(true);
    // 이전 버전과 풀이 기록은 그대로다.
    expect(getQuestion(d, { id: q.id, version: q.version })).toBeTruthy();
    expect(d.attempts.filter((a) => a.questionId === q.id)).toHaveLength(1);
  });
  it('객관식은 수동 채점할 수 없다', async () => {
    const repo = new DemoRepository();
    const bank = structuredClone(example);
    bank.bank.id = 'accept-mc';
    await repo.importBank(bank);
    const d = await repo.load();
    const q = filterQuestions(d, emptyFilters).find(
      (x) => x.id.startsWith('accept-mc') && x.type === 'multiple_choice',
    )!;
    const session = createSession(d, [q], 'learn', 1);
    const key = `${q.id}@${q.version}`;
    const answered = { ...session, answers: { [key]: ['Z'] } };
    const id = crypto.randomUUID();
    await repo.commitSession(answered, [
      { id, questionId: q.id, questionVersion: q.version, answer: ['Z'], durationMs: 5 },
    ]);
    await expect(
      repo.commitSession({ ...answered, revision: 1 }, [
        {
          id,
          questionId: q.id,
          questionVersion: q.version,
          answer: ['Z'],
          durationMs: 5,
          manualScore: 1,
        },
      ]),
    ).rejects.toThrow('단답형·빈칸');
  });
});
