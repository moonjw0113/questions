import type { Grade, Question } from './types';

// Deliberately conservative: keep minus signs, decimal points, operators and accents.
export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s,，。!！?？;；:'"“”‘’]/gu, '');
}
export function gradeAnswer(question: Question, answer: string[]): Grade {
  const matches = (value: string, accepted: string[]) =>
    accepted.some((a) => normalizeAnswer(a) === normalizeAnswer(value)) &&
    normalizeAnswer(value).length > 0;
  let blankResults: boolean[];
  if (question.type === 'multiple_choice') blankResults = [answer[0] === question.correctOptionId];
  else if (question.type === 'short_answer')
    blankResults = [matches(answer[0] || '', question.acceptedAnswers)];
  else blankResults = question.blanks.map((b, i) => matches(answer[i] || '', b.acceptedAnswers));
  const score = blankResults.filter(Boolean).length / blankResults.length;
  return { score, correct: score === 1, partial: score > 0 && score < 1, blankResults };
}
/** 사용자가 직접 정답·오답으로 처리한 채점. 빈칸 문제는 모든 빈칸을 같은 결과로 둔다. */
export function manualGrade(q: Question, score: 0 | 1): Grade {
  const n = q.type === 'fill_blank' ? q.blanks.length : 1;
  return {
    score,
    correct: score === 1,
    partial: false,
    blankResults: Array.from({ length: n }, () => score === 1),
  };
}
/** 수동으로 정답 처리할 수 있는 유형(객관식은 정답이 하나로 정해져 있어 제외). */
export const canAcceptManually = (q: Question) =>
  q.type === 'short_answer' || q.type === 'fill_blank';
/**
 * 틀린 답(빈칸)을 정답 목록에 더한 문제. 이미 정답으로 인정되는 답이나 빈 답은 더하지 않는다.
 * 더할 것이 없으면 null.
 */
export function withAcceptedAnswer(q: Question, answer: string[]): Question | null {
  const add = (accepted: string[], value: string | undefined) => {
    const v = (value || '').trim();
    if (!normalizeAnswer(v) || accepted.some((a) => normalizeAnswer(a) === normalizeAnswer(v)))
      return accepted;
    return accepted.length >= 30 ? accepted : [...accepted, v];
  };
  if (q.type === 'short_answer') {
    const acceptedAnswers = add(q.acceptedAnswers, answer[0]);
    return acceptedAnswers === q.acceptedAnswers ? null : { ...q, acceptedAnswers };
  }
  if (q.type === 'fill_blank') {
    const blanks = q.blanks.map((b, i) => {
      const acceptedAnswers = add(b.acceptedAnswers, answer[i]);
      return acceptedAnswers === b.acceptedAnswers ? b : { ...b, acceptedAnswers };
    });
    return blanks.every((b, i) => b === q.blanks[i]) ? null : { ...q, blanks };
  }
  return null;
}
export function modelAnswers(q: Question): string[] {
  if (q.type === 'multiple_choice')
    return [q.options.find((o) => o.id === q.correctOptionId)?.text || ''];
  if (q.type === 'short_answer') return [q.acceptedAnswers[0]];
  return q.blanks.map((b) => b.acceptedAnswers[0]);
}
export function completedSentence(q: Question) {
  return q.type === 'fill_blank'
    ? q.content.replace(
        /\{\{([^{}]+)\}\}/g,
        (_, id: string) => q.blanks.find((b) => b.id === id)?.acceptedAnswers[0] || '',
      )
    : q.content;
}
