import { describe, it, expect, beforeEach } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { normalizeAnswer, gradeAnswer, completedSentence } from '../src/domain/grading';
import {
  parseBank,
  normalizeBank,
  inspectImport,
  externalKey,
  toImportQuestion,
} from '../src/domain/import';
import { scheduleReview } from '../src/domain/review';
import { createSession, shuffle } from '../src/domain/study';
import { analysisExport, dayKey, getStats } from '../src/domain/statistics';
import { defaultSettings, type QuestionBank, type AppData } from '../src/domain/types';
import { DemoRepository, validateBackup } from '../src/data/repository';
const example = JSON.parse(readFileSync('public/examples/biology.json', 'utf8')) as QuestionBank;
const empty = (): AppData => ({
  subjects: [],
  banks: [],
  entries: [],
  versions: [],
  attempts: [],
  sessions: [],
  progress: [],
  settings: { ...defaultSettings },
});
const normalized = normalizeBank(example);
describe('고정 v1.0 업로드 계약', () => {
  for (const type of ['multiple_choice', 'short_answer', 'fill_blank'])
    it(`${type} 독립 예제를 검증하고 내부 타입으로 변환`, () => {
      const parsed = parseBank(readFileSync(`public/examples/${type}.json`, 'utf8'));
      expect(parsed.errors).toEqual([]);
      const result = normalizeBank(parsed.bank!);
      expect(result.questions[0].type).toBe(type);
      expect(toImportQuestion(result.questions[0])).toEqual(parsed.bank!.questions[0]);
    });
  it('구형 필드와 추가 필드를 거부', () => {
    expect(parseBank(JSON.stringify({ ...example, schemaVersion: '1.0' })).bank).toBeUndefined();
    expect(parseBank('{bad').errors[0]).toContain('JSON 구문');
  });
  it('은행 내 중복 ID 거부', () => {
    const b = structuredClone(example);
    b.questions.push(b.questions[0]);
    expect(parseBank(JSON.stringify(b)).errors[0]).toContain('중복');
  });
  it('존재하지 않는 객관식 정답 거부', () => {
    const b = structuredClone(example);
    if (b.questions[0].type === 'multiple_choice') b.questions[0].answer.option_id = 'MISSING';
    expect(parseBank(JSON.stringify(b)).errors[0]).toContain('option_id');
  });
  it('빈칸 ID, 개수, 반복 placeholder 검증', () => {
    const b = structuredClone(example);
    b.questions[2].prompt += ' {{1}}';
    expect(parseBank(JSON.stringify(b)).errors[0]).toContain('빈칸');
  });
  it('답안이 공백·문장부호뿐인 문제 거부', () => {
    const b = structuredClone(example);
    if (b.questions[1].type === 'short_answer') b.questions[1].answer.accepted = ['!!'];
    expect(parseBank(JSON.stringify(b)).errors[0]).toContain('비어');
  });
  it('문제 ID는 은행마다 독립적', () => {
    expect(externalKey('a', 'q1')).not.toBe(externalKey('b', 'q1'));
  });
  it('같은 파일 제외, 변경된 내용 버전 증가, 과거 내용 재업로드는 회귀하지 않음', () => {
    const d = empty();
    d.banks = [{ ...example.bank, createdAt: new Date().toISOString() }];
    d.versions = normalized.questions.map((question) => ({ bankId: example.bank.id, question }));
    d.entries = normalized.questions.map((q) => ({
      id: q.id,
      bankId: example.bank.id,
      currentVersion: 1,
      favorite: false,
      archived: false,
      report: '',
    }));
    expect(inspectImport(example, d)).toMatchObject({ added: 0, updated: 0, skipped: 4 });
    const changed = structuredClone(example);
    changed.questions[0].explanation += ' 새 설명';
    expect(normalizeBank(changed, d).questions[0].version).toBe(2);
    expect(inspectImport(changed, d).updated).toBe(1);
    d.versions.push({ bankId: example.bank.id, question: normalizeBank(changed, d).questions[0] });
    d.entries[0].currentVersion = 2;
    expect(normalizeBank(example, d).questions[0].version).toBe(1);
    expect(inspectImport(example, d).skipped).toBe(4);
  });
});
describe('보수적인 채점', () => {
  it('공백·일부 문장부호 무시, NFC 한글·영문 소문자 정규화', () => {
    expect(normalizeAnswer('  활성화 에너지! ')).toBe('활성화에너지');
    expect(normalizeAnswer('Ａ')).not.toBe(normalizeAnswer('A'));
    expect(normalizeAnswer('ADP')).toBe('adp');
    expect(normalizeAnswer('가'.normalize('NFD'))).toBe('가');
  });
  it('음수·소수점·기호·부정 표현 보존', () => {
    expect(normalizeAnswer('-1')).not.toBe(normalizeAnswer('1'));
    expect(normalizeAnswer('1.2')).not.toBe(normalizeAnswer('12'));
    expect(normalizeAnswer('안 한다')).not.toBe(normalizeAnswer('한다'));
  });
  it('등록 동의어만 허용', () => {
    const q = normalized.questions.find((q) => q.type === 'short_answer')!;
    expect(gradeAnswer(q, [' activation energy! ']).correct).toBe(true);
    expect(gradeAnswer(q, ['에너지']).correct).toBe(false);
    expect(gradeAnswer(q, ['']).correct).toBe(false);
  });
  it('객관식 위치가 아니라 원래 ID로 채점', () => {
    const q = normalized.questions[0];
    expect(gradeAnswer(q, ['B']).correct).toBe(true);
    expect(gradeAnswer(q, ['A']).correct).toBe(false);
  });
  it('빈칸별 부분 점수와 완성 문장', () => {
    const q = normalized.questions[2];
    expect(gradeAnswer(q, ['동화', '잘못된 답'])).toEqual({
      score: 0.5,
      correct: false,
      partial: true,
      blankResults: [true, false],
    });
    expect(completedSentence(q)).not.toContain('{{');
  });
});
describe('복습과 학습 범위', () => {
  it('오답 10분, 연속 정답 간격 증가, 재오답 감소', () => {
    const at = '2026-10-26T00:00:00Z';
    const wrong = scheduleReview(undefined, 0, at, 'standard', 'q');
    expect(Date.parse(wrong.nextDue) - Date.parse(at)).toBe(600000);
    const a = scheduleReview(wrong, 1, at),
      b = scheduleReview(a, 1, at),
      c = scheduleReview(b, 1, at);
    expect(a.interval).toBe(1);
    expect(b.interval).toBe(6);
    expect(c.interval).toBeGreaterThan(6);
    expect(scheduleReview(c, 0, at).interval).toBeLessThan(c.interval);
  });
  it('부분 정답은 숙련으로 취급하지 않고 복습 대상', () => {
    const p = scheduleReview(undefined, 0.5, new Date().toISOString());
    expect(p.repetitions).toBe(0);
    expect(p.mastery).toBeLessThan(30);
  });
  it('섞어도 선택지 정체성과 항목 수 유지', () => {
    const a = ['A', 'B', 'C', 'D'];
    expect(shuffle(a).sort()).toEqual(a);
    expect(a).toEqual(['A', 'B', 'C', 'D']);
  });
});
describe('분석 내보내기', () => {
  it('KST 날짜 경계', () => {
    expect(dayKey('2026-10-26T15:01:00Z')).toBe('2026-10-27');
  });
  it('정의한 study_result 스키마 통과 및 개인정보 제외', () => {
    const output = analysisExport(empty(), { period: 'all', subject: '', unit: '' });
    const schema = JSON.parse(readFileSync('public/study-result.schema.json', 'utf8'));
    const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
    expect(validate(output), JSON.stringify(validate.errors)).toBe(true);
    expect(JSON.stringify(output)).not.toMatch(/user_id|sessionId|email|dbId/);
  });
});
describe('체험 저장소 전체 흐름', () => {
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
  it('손상된 기록을 조용히 초기화하지 않고 원본을 보존', async () => {
    localStorage.setItem('chagok-demo-v1', '{broken');
    await expect(new DemoRepository().load()).rejects.toThrow('원본 데이터는 보존');
    expect(localStorage.getItem('chagok-demo-v1')).toBe('{broken');
  });
  it('백업 버전 충돌 시 전체 복원을 취소', async () => {
    const repo = new DemoRepository(),
      before = await repo.load(),
      backup = structuredClone(before);
    backup.versions[0].question.explanation += '충돌 내용';
    await expect(repo.restore(backup)).rejects.toThrow('버전 충돌');
    expect(await repo.load()).toEqual(before);
  });
  it('업로드 → 풀이 → 저장 → 재개 → 수정 → 복원, 기록 유지', async () => {
    const repo = new DemoRepository();
    let d = await repo.load();
    const baseline = d.attempts.length;
    const b = structuredClone(example);
    b.bank.id = 'integration-bank';
    await repo.importBank(b);
    await repo.importBank(b);
    d = await repo.load();
    expect(d.entries.filter((e) => e.bankId === b.bank.id)).toHaveLength(4);
    const qs = normalizeBank(b, d).questions;
    let session = createSession(d, qs, 'learn', 1);
    await repo.commitSession(session);
    d = await repo.load();
    session = d.sessions.find((s) => s.id === session.id)!;
    const q = qs.find((q) => q.id === session.queue[0].id)!;
    const ans =
      q.type === 'multiple_choice'
        ? [q.correctOptionId]
        : q.type === 'short_answer'
          ? [q.acceptedAnswers[0]]
          : q.blanks.map((b) => b.acceptedAnswers[0]);
    session.answers[`${q.id}@${q.version}`] = ans;
    await repo.commitSession(session, [
      {
        id: crypto.randomUUID(),
        questionId: q.id,
        questionVersion: q.version,
        answer: ans,
        durationMs: 5000,
      },
    ]);
    d = await repo.load();
    expect(d.attempts).toHaveLength(baseline + 1);
    expect(d.sessions.find((s) => s.id === session.id)!.answers[`${q.id}@1`]).toEqual(ans);
    b.questions[0].explanation += ' changed';
    await repo.importBank(b);
    d = await repo.load();
    expect(d.attempts).toHaveLength(baseline + 1);
    const backup = structuredClone(d);
    await repo.restore(backup);
    await repo.restore(backup);
    d = await repo.load();
    expect(d.attempts).toHaveLength(baseline + 1);
    expect(validateBackup(d)).toBe(d);
    expect(getStats(d).total).toBe(baseline + 1);
    const validate = new Ajv({ strict: false }).compile(
      JSON.parse(readFileSync('public/study-result.schema.json', 'utf8')),
    );
    expect(validate(analysisExport(d, { period: 'all', subject: '', unit: '' }))).toBe(true);
  });
});
