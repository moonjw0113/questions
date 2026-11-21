import {
  currentQuestions,
  type AppData,
  type Filters,
  type Question,
  type StudyMode,
  type StudySession,
  questionKey,
} from './types';
export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function filterQuestions(d: AppData, f: Filters, now = Date.now()): Question[] {
  return currentQuestions(d).filter((q) => {
    const progress = d.progress.find((p) => p.questionId === q.id);
    const last = d.attempts
      .filter((a) => a.questionId === q.id)
      .sort((a, b) => b.answeredAt.localeCompare(a.answeredAt))[0];
    return (
      (!f.subject || q.subject === f.subject) &&
      (!f.units.length ||
        f.units.some((unit) => unit.subject === q.subject && unit.unit === q.unit)) &&
      (!f.type || q.type === f.type) &&
      (!f.difficulty || q.difficulty === Number(f.difficulty)) &&
      (f.scope !== 'wrong' || Boolean(last && last.score < 1)) &&
      (f.scope !== 'due' || Boolean(progress && Date.parse(progress.nextDue) <= now)) &&
      (f.scope !== 'favorite' || Boolean(d.entries.find((e) => e.id === q.id)?.favorite)) &&
      (!f.search ||
        [q.content, q.topic, ...q.tags, q.unit, q.subject]
          .join(' ')
          .toLowerCase()
          .includes(f.search.toLowerCase()))
    );
  });
}
/**
 * How many rounds each question is ahead of the rest of its unit, within the chosen range.
 * 0 means "not solved yet in this round". Once every question of a unit in the range has been
 * solved, the whole unit is back at 0, while the attempt history keeps every solve.
 */
export function roundLag(d: AppData, questions: Question[]): Map<string, number> {
  const solved = new Map<string, number>();
  for (const a of d.attempts) solved.set(a.questionId, (solved.get(a.questionId) || 0) + 1);
  const unitKey = (q: Question) => `${q.subject}\u0000${q.unit}`;
  const floor = new Map<string, number>();
  for (const q of questions) {
    const n = solved.get(q.id) || 0;
    floor.set(unitKey(q), Math.min(floor.get(unitKey(q)) ?? n, n));
  }
  return new Map(questions.map((q) => [q.id, (solved.get(q.id) || 0) - floor.get(unitKey(q))!]));
}
export const unsolvedInRound = (d: AppData, questions: Question[]) => {
  const lag = roundLag(d, questions);
  return questions.filter((q) => lag.get(q.id) === 0);
};
export function createSession(
  d: AppData,
  questions: Question[],
  mode: StudyMode,
  count: number,
): StudySession {
  // Learn and exam only hand out this round's unsolved questions; if fewer than `count`
  // remain, the session is simply shorter, as it always was when a range ran short.
  const pool = mode === 'review' ? questions : unsolvedInRound(d, questions);
  let queue = mode === 'exam' || d.settings.shuffleQuestions ? shuffle(pool) : [...pool];
  if (mode === 'review')
    queue.sort((a, b) => {
      const pa = d.progress.find((p) => p.questionId === a.id),
        pb = d.progress.find((p) => p.questionId === b.id);
      const priority = (p: typeof pa) =>
        p ? (Date.parse(p.nextDue) <= Date.now() ? -1000 : 0) + p.mastery : 50;
      return priority(pa) - priority(pb);
    });
  queue = queue.slice(0, count);
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    mode,
    status: 'active',
    queue: queue.map((q) => ({ id: q.id, version: q.version })),
    index: 0,
    answers: {},
    durations: {},
    choiceOrders: Object.fromEntries(
      queue
        .filter((q) => q.type === 'multiple_choice')
        .map((q) => [
          questionKey(q),
          q.type === 'multiple_choice'
            ? (d.settings.shuffleChoices ? shuffle(q.options) : q.options).map((o) => o.id)
            : [],
        ]),
    ),
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    revision: 0,
  };
}
