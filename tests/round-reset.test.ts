import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeBank } from '../src/domain/import';
import { createSession, resetRounds, roundCounts, unsolvedInRound } from '../src/domain/study';
import { defaultSettings, type AppData, type QuestionBank } from '../src/domain/types';
import { validateBackup } from '../src/data/repository';

const example = JSON.parse(readFileSync('public/examples/biology.json', 'utf8')) as QuestionBank;
const base = normalizeBank(example).questions[1];

function setup(solved: Record<string, string[]>) {
  const questions = ['a', 'b', 'c'].map((id) => ({ ...base, id, unit: '1단원' }));
  const d: AppData = {
    subjects: [],
    banks: [],
    entries: questions.map((q) => ({
      id: q.id,
      bankId: 'test',
      currentVersion: q.version,
      favorite: false,
      archived: false,
      report: '',
    })),
    versions: questions.map((question) => ({ bankId: 'test', question })),
    attempts: Object.entries(solved).flatMap(([questionId, times]) =>
      times.map((answeredAt, i) => ({
        id: `${questionId}-${i}`,
        sessionId: 's',
        questionId,
        questionVersion: 1,
        answer: ['x'],
        durationMs: 1000,
        mode: 'learn' as const,
        answeredAt,
        attemptNumber: i + 1,
        manual: false,
        score: 1,
        correct: true,
        partial: false,
        blankResults: [],
      })),
    ),
    sessions: [],
    progress: [],
    settings: { ...defaultSettings },
  };
  return { d, questions };
}
const day = (n: number) => new Date(Date.UTC(2026, 10, n)).toISOString();
const ids = (qs: { id: string }[]) => qs.map((q) => q.id).sort();

describe('안 푼 문제 카운트와 초기화', () => {
  it('초기화하기 전에는 풀이 수와 같다', () => {
    const { d, questions } = setup({ a: [day(1), day(2)], b: [day(1)] });
    expect(Object.fromEntries(roundCounts(d))).toEqual({ a: 2, b: 1 });
    expect(ids(unsolvedInRound(d, questions))).toEqual(['c']);
  });
  it('초기화하면 고른 문제가 모두 안 푼 문제가 되고, 그 뒤 풀이부터 다시 센다', () => {
    const { d, questions } = setup({ a: [day(1), day(2)], b: [day(1)] });
    d.settings = resetRounds(d, questions, day(3));
    expect(roundCounts(d).size).toBe(0);
    expect(ids(unsolvedInRound(d, questions))).toEqual(['a', 'b', 'c']);
    // 풀이 기록은 그대로다.
    expect(d.attempts).toHaveLength(3);
    d.attempts.push({ ...d.attempts[0], id: 'a-new', answeredAt: day(4) });
    expect(Object.fromEntries(roundCounts(d))).toEqual({ a: 1 });
    expect(ids(unsolvedInRound(d, questions))).toEqual(['b', 'c']);
    const picked = createSession(d, questions, 'learn', 10)
      .queue.map((r) => r.id)
      .sort();
    expect(picked).toEqual(['b', 'c']);
  });
  it('집중 복습·틀린 문제 다시 풀기로 푼 것은 세지 않는다', () => {
    const { d, questions } = setup({ a: [day(1)], b: [day(1)] });
    d.attempts[1] = { ...d.attempts[1], mode: 'review' };
    expect(Object.fromEntries(roundCounts(d))).toEqual({ a: 1 });
    expect(ids(unsolvedInRound(d, questions))).toEqual(['b', 'c']);
    // 풀이 기록 자체는 남아 통계·복습 일정에는 그대로 쓰인다.
    expect(d.attempts).toHaveLength(2);
  });
  it('범위 밖 문제는 초기화하지 않는다', () => {
    const { d, questions } = setup({ a: [day(1)], b: [day(1)] });
    d.settings = resetRounds(d, [questions[0]], day(3));
    expect(Object.fromEntries(roundCounts(d))).toEqual({ b: 1 });
    expect(d.settings.roundResets).toEqual({ a: day(3) });
  });
  it('백업 검사는 초기화 기록 형식을 확인한다', () => {
    const { d, questions } = setup({});
    // 문제 없이 설정만 담은 최소 백업으로 설정 검사만 본다.
    const backup: AppData = {
      ...d,
      entries: [],
      versions: [],
      settings: resetRounds(d, questions, day(3)),
    };
    expect(() => validateBackup(structuredClone(backup))).not.toThrow();
    backup.settings.roundResets = { a: 'not a date' };
    expect(() => validateBackup(structuredClone(backup))).toThrow('설정 값');
  });
});
