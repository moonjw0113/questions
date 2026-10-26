import Ajv from 'ajv';
import { schema } from 'virtual:study-content';
import { normalizeAnswer } from './grading';
import type { AppData, ImportQuestion, InternalBank, Question, QuestionBank } from './types';
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
export const externalKey = (bankId: string, questionId: string) => `${bankId}::${questionId}`;
export function parseBank(text: string): { bank?: QuestionBank; errors: string[] } {
  if (text.length > 10 * 1024 * 1024) return { errors: ['최대 파일 크기는 10MB입니다.'] };
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    return { errors: [`JSON 구문 오류: ${(e as Error).message}`] };
  }
  if (!validate(value))
    return {
      errors: (validate.errors || [])
        .map(
          (e) =>
            `${e.instancePath || '/'}: ${e.message}${e.params.missingProperty ? ` (${e.params.missingProperty})` : ''}`,
        )
        .slice(0, 50),
    };
  const bank = value as unknown as QuestionBank,
    errors: string[] = [],
    ids = new Set<string>();
  bank.questions.forEach((q, i) => {
    const at = `문제 ${i + 1} (${q.id})`;
    if (ids.has(q.id)) errors.push(`${at}: 문제은행 내 문제 ID가 중복됩니다.`);
    ids.add(q.id);
    if (q.type === 'multiple_choice') {
      if (new Set(q.options.map((o) => o.id)).size !== q.options.length)
        errors.push(`${at}: 선택지 ID가 중복됩니다.`);
      if (!q.options.some((o) => o.id === q.answer.option_id))
        errors.push(`${at}: answer.option_id가 선택지에 없습니다.`);
    } else {
      const lists =
        q.type === 'short_answer' ? [q.answer.accepted] : q.answer.blanks.map((b) => b.accepted);
      if (lists.some((list) => list.some((a) => !normalizeAnswer(a))))
        errors.push(`${at}: 비어 있는 허용 답안은 등록할 수 없습니다.`);
      if (q.type === 'fill_blank') {
        const placeholders = [...q.prompt.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1]);
        const blanks = q.answer.blanks;
        if (
          new Set(blanks.map((b) => b.id)).size !== blanks.length ||
          placeholders.length !== blanks.length ||
          blanks.some((b) => placeholders.filter((p) => p === b.id).length !== 1)
        )
          errors.push(`${at}: 각 빈칸 ID를 본문에 {{1}}, {{2}} 형태로 정확히 한 번 넣어 주세요.`);
      }
    }
  });
  return errors.length ? { errors } : { bank, errors: [] };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function toImportQuestion(q: Question): ImportQuestion {
  const base = {
    id: q.sourceId,
    topic: q.topic,
    difficulty: q.difficulty,
    prompt: q.content,
    explanation: q.explanation,
    tags: q.tags,
  };
  if (q.type === 'multiple_choice')
    return { ...base, type: q.type, options: q.options, answer: { option_id: q.correctOptionId } };
  if (q.type === 'short_answer')
    return { ...base, type: q.type, answer: { accepted: q.acceptedAnswers } };
  return {
    ...base,
    type: q.type,
    answer: { blanks: q.blanks.map((b) => ({ id: b.id, accepted: b.acceptedAnswers })) },
  };
}
export function normalizeBank(bank: QuestionBank, d?: AppData): InternalBank {
  return {
    bank: bank.bank,
    questions: bank.questions.map((raw) => {
      const id = externalKey(bank.bank.id, raw.id);
      const old = d?.versions.filter((v) => v.question.id === id) || [];
      const known = old.find(
        (v) =>
          canonical(toImportQuestion(v.question)) === canonical(raw) &&
          v.question.subject === bank.bank.subject &&
          v.question.unit === bank.bank.unit,
      );
      const base = {
        id,
        sourceId: raw.id,
        version: known?.question.version || Math.max(0, ...old.map((v) => v.question.version)) + 1,
        subject: bank.bank.subject,
        unit: bank.bank.unit,
        topic: raw.topic,
        tags: raw.tags,
        content: raw.prompt,
        explanation: raw.explanation,
        difficulty: raw.difficulty,
        source: 'ChatGPT Work · JSON v1.0',
        createdAt: known?.question.createdAt || new Date().toISOString(),
      };
      if (raw.type === 'multiple_choice')
        return {
          ...base,
          type: raw.type,
          options: raw.options,
          correctOptionId: raw.answer.option_id,
        };
      if (raw.type === 'short_answer')
        return { ...base, type: raw.type, acceptedAnswers: raw.answer.accepted };
      return {
        ...base,
        type: raw.type,
        blanks: raw.answer.blanks.map((b) => ({ id: b.id, acceptedAnswers: b.accepted })),
      };
    }),
  };
}
export function inspectImport(bank: QuestionBank, d: AppData) {
  const result = { added: 0, updated: 0, skipped: 0, errors: [] as string[] };
  const existingBank = d.banks.find((b) => b.id === bank.bank.id);
  if (
    existingBank &&
    (existingBank.subject !== bank.bank.subject || existingBank.unit !== bank.bank.unit)
  )
    result.errors.push(
      '같은 문제은행 ID의 과목·단원은 변경할 수 없습니다. 새로운 문제은행 ID를 사용해 주세요.',
    );
  for (const q of normalizeBank(bank, d).questions) {
    const existing = d.entries.find((e) => e.id === q.id);
    if (d.versions.some((v) => v.question.id === q.id && v.question.version === q.version))
      result.skipped++;
    else if (existing) result.updated++;
    else result.added++;
  }
  return result;
}
