import fs from 'node:fs';
const object = (properties) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const string = { type: 'string' },
  number = { type: 'number' },
  integer = { type: 'integer', minimum: 0 },
  percentage = { type: 'number', minimum: 0, maximum: 100 },
  array = (items) => ({ type: 'array', items });
const stats = array(object({ name: string, attempts: integer, accuracy: percentage }));
const question = JSON.parse(fs.readFileSync('public/question-bank.schema.json', 'utf8')).properties
  .questions.items;
const result = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://chagok.local/study-result.schema.json',
  title: '차곡 study_result v1.0',
  ...object({
    schema_version: { const: '1.0' },
    type: { const: 'study_result' },
    generated_at: string,
    time_zone: { const: 'Asia/Seoul' },
    scope: object({ period: { enum: ['all', '7', '30', 'wrong'] }, subject: string, unit: string }),
    scoring: string,
    summary: object({ attempts: integer, accuracy: percentage, recent_accuracy: percentage }),
    statistics: object({ by_subject: stats, by_unit: stats, by_type: stats }),
    weak_concepts: stats,
    additional_study_topics: array(string),
    question_mastery: array(
      object({
        bank_id: string,
        question_id: string,
        mastery: percentage,
        next_due: string,
        total_attempts: integer,
        recent_scores: array({ type: 'number', minimum: 0, maximum: 1 }),
      }),
    ),
    questions: array(
      object({
        bank_id: string,
        subject: string,
        unit: string,
        internal_version: { type: 'integer', minimum: 1 },
        question,
      }),
    ),
    frequent_errors: array(object({ bank_id: string, question_id: string, wrong_count: integer })),
    recent_results: array(
      object({
        bank_id: string,
        question_id: string,
        internal_version: { type: 'integer', minimum: 1 },
        answered_at: string,
        user_answer: array(string),
        model_answers: array(string),
        score: { type: 'number', minimum: 0, maximum: 1 },
        is_correct: { type: 'boolean' },
        is_partial: { type: 'boolean' },
        manual_override: { type: 'boolean' },
        duration_ms: { ...integer, maximum: 604800000 },
        mode: { enum: ['learn', 'review', 'exam'] },
        cumulative_attempts: { type: 'integer', minimum: 1 },
      }),
    ),
  }),
};
fs.writeFileSync('public/study-result.schema.json', JSON.stringify(result, null, 2) + '\n');
