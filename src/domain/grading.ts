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
