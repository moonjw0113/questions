import type { ReviewProgress, Settings } from './types';
export const paceFactor = (pace: Settings['reviewPace']) =>
  pace === 'gentle' ? 1.3 : pace === 'intensive' ? 0.7 : 1;
// SM-2 adaptation: wrong = quality 1, partial = 2, correct = 4.
// Same-day repetitions still count as practice, never as proof of conceptual understanding.
export function scheduleReview(
  previous: ReviewProgress | undefined,
  score: number,
  at: string,
  pace: Settings['reviewPace'] = 'standard',
  questionId = '',
): ReviewProgress {
  const p = previous || {
    questionId,
    repetitions: 0,
    interval: 0,
    ease: 2.5,
    mastery: 0,
    nextDue: at,
    totalAttempts: 0,
    correctCount: 0,
    recentScores: [],
  };
  const quality = score === 1 ? 4 : score > 0 ? 2 : 1;
  const ease = Math.max(1.3, p.ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const repetitions = score === 1 ? p.repetitions + 1 : 0;
  const interval =
    score < 1
      ? 10 / 1440
      : Math.min(
          365,
          (repetitions === 1
            ? 1
            : repetitions === 2
              ? 6
              : Math.max(1, Math.round(p.interval * p.ease))) * paceFactor(pace),
        );
  const recentScores = [...p.recentScores, score].slice(-10);
  const weighted =
    recentScores.reduce((sum, s, i) => sum + s * (i + 1), 0) /
    recentScores.reduce((sum, _, i) => sum + i + 1, 0);
  return {
    questionId: p.questionId,
    repetitions,
    interval,
    ease,
    recentScores,
    totalAttempts: p.totalAttempts + 1,
    correctCount: p.correctCount + (score === 1 ? 1 : 0),
    mastery: Math.round(weighted * Math.min(1, (repetitions + 1) / 5) * 100),
    nextDue: new Date(new Date(at).getTime() + interval * 86400000).toISOString(),
  };
}
