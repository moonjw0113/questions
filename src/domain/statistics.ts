import { getQuestion, type AppData, type Attempt } from './types';
import { modelAnswers } from './grading';
import { toImportQuestion } from './import';
export const dayKey = (date: string | Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
export const percentage = (values: number[]) =>
  values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) : 0;
export function groupStats(
  d: AppData,
  attempts: Attempt[],
  group: 'subject' | 'unit' | 'type' | 'topic' | 'tags',
) {
  const groups = new Map<string, number[]>();
  attempts.forEach((a) => {
    const q = getQuestion(d, { id: a.questionId, version: a.questionVersion });
    if (!q) return;
    const keys =
      group === 'tags' ? q.tags : group === 'unit' ? [`${q.subject} · ${q.unit}`] : [q[group]];
    keys.forEach((key) => groups.set(key, [...(groups.get(key) || []), a.score]));
  });
  return [...groups]
    .map(([name, scores]) => ({ name, attempts: scores.length, accuracy: percentage(scores) }))
    .sort((a, b) => a.accuracy - b.accuracy);
}
export function getStats(d: AppData) {
  const sorted = [...d.attempts].sort((a, b) => b.answeredAt.localeCompare(a.answeredAt));
  const today = sorted.filter((a) => dayKey(a.answeredAt) === dayKey());
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.now() - (6 - i) * 86400000),
      key = dayKey(date);
    const attempts = sorted.filter((a) => dayKey(a.answeredAt) === key);
    return {
      date: key,
      label: ['일', '월', '화', '수', '목', '금', '토'][
        new Date(`${key}T12:00:00+09:00`).getUTCDay()
      ],
      count: attempts.length,
      accuracy: percentage(attempts.map((a) => a.score)),
    };
  });
  const uniqueDays = new Set(sorted.map((a) => dayKey(a.answeredAt)));
  let streak = 0,
    offset = uniqueDays.has(dayKey()) ? 0 : 1;
  while (uniqueDays.has(dayKey(new Date(Date.now() - offset * 86400000)))) {
    streak++;
    offset++;
  }
  const active = new Set(d.entries.filter((e) => !e.archived).map((e) => e.id));
  return {
    total: sorted.length,
    today: today.length,
    accuracy: percentage(sorted.map((a) => a.score)),
    recentAccuracy: percentage(sorted.slice(0, 30).map((a) => a.score)),
    todayMinutes: Math.round(today.reduce((s, a) => s + a.durationMs, 0) / 60000),
    streak,
    days,
    due: d.progress.filter((p) => active.has(p.questionId) && Date.parse(p.nextDue) <= Date.now())
      .length,
    subjects: groupStats(d, sorted, 'subject'),
    units: groupStats(d, sorted, 'unit'),
    topics: groupStats(d, sorted.slice(0, 100), 'tags'),
    types: groupStats(d, sorted, 'type'),
  };
}
export interface ExportScope {
  period: 'all' | '7' | '30' | 'wrong';
  subject: string;
  unit: string;
}
export function analysisExport(d: AppData, scope: ExportScope) {
  const attempts = d.attempts
    .filter((a) => {
      const q = getQuestion(d, { id: a.questionId, version: a.questionVersion });
      return (
        q &&
        (!scope.subject || q.subject === scope.subject) &&
        (!scope.unit || q.unit === scope.unit) &&
        (scope.period !== 'wrong' || a.score < 1) &&
        (!['7', '30'].includes(scope.period) ||
          Date.parse(a.answeredAt) >= Date.now() - Number(scope.period) * 86400000)
      );
    })
    .sort((a, b) => b.answeredAt.localeCompare(a.answeredAt));
  const ids = new Set(attempts.map((a) => a.questionId));
  const concepts = groupStats(d, attempts.slice(0, 100), 'tags');
  return {
    schema_version: '1.0',
    type: 'study_result',
    generated_at: new Date().toISOString(),
    time_zone: 'Asia/Seoul',
    scope,
    scoring:
      'accuracy = average fractional score; mastery is item recall, not concept understanding',
    summary: {
      attempts: attempts.length,
      accuracy: percentage(attempts.map((a) => a.score)),
      recent_accuracy: percentage(attempts.slice(0, 30).map((a) => a.score)),
    },
    statistics: {
      by_subject: groupStats(d, attempts, 'subject'),
      by_unit: groupStats(d, attempts, 'unit'),
      by_type: groupStats(d, attempts, 'type'),
    },
    weak_concepts: concepts.filter((c) => c.accuracy < 80),
    additional_study_topics: concepts.filter((c) => c.accuracy < 70).map((c) => c.name),
    question_mastery: d.progress
      .filter((p) => ids.has(p.questionId))
      .map((p) => ({
        bank_id: p.questionId.split('::')[0],
        question_id: p.questionId.split('::')[1],
        mastery: p.mastery,
        next_due: p.nextDue,
        total_attempts: p.totalAttempts,
        recent_scores: p.recentScores,
      })),
    questions: d.versions
      .filter((v) =>
        attempts.some(
          (a) => a.questionId === v.question.id && a.questionVersion === v.question.version,
        ),
      )
      .map((v) => ({
        bank_id: v.bankId,
        subject: v.question.subject,
        unit: v.question.unit,
        internal_version: v.question.version,
        question: toImportQuestion(v.question),
      })),
    frequent_errors: [...ids]
      .map((id) => ({
        bank_id: id.split('::')[0],
        question_id: id.split('::')[1],
        wrong_count: attempts.filter((a) => a.questionId === id && a.score < 1).length,
      }))
      .filter((v) => v.wrong_count)
      .sort((a, b) => b.wrong_count - a.wrong_count),
    recent_results: attempts.map((a) => {
      const q = getQuestion(d, { id: a.questionId, version: a.questionVersion })!;
      return {
        bank_id: a.questionId.split('::')[0],
        question_id: q.sourceId,
        internal_version: a.questionVersion,
        answered_at: a.answeredAt,
        user_answer: a.answer,
        model_answers: modelAnswers(q),
        score: a.score,
        is_correct: a.correct,
        is_partial: a.partial,
        manual_override: a.manual,
        duration_ms: a.durationMs,
        mode: a.mode,
        cumulative_attempts: a.attemptNumber,
      };
    }),
  };
}
export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
