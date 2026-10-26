import fs from 'node:fs';
const text = { type: 'string', minLength: 1, maxLength: 10000, pattern: '\\S' };
const id = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,100}$' };
const answers = { type: 'array', minItems: 1, maxItems: 30, uniqueItems: true, items: text };
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const common = {
  id,
  type: { enum: ['multiple_choice', 'short_answer', 'fill_blank'] },
  topic: text,
  difficulty: { type: 'integer', minimum: 1, maximum: 3 },
  prompt: text,
  explanation: text,
  tags: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: text },
};
const question = {
  oneOf: [
    object({
      ...common,
      type: { const: 'multiple_choice' },
      options: { type: 'array', minItems: 2, maxItems: 10, items: object({ id, text }) },
      answer: object({ option_id: id }),
    }),
    object({ ...common, type: { const: 'short_answer' }, answer: object({ accepted: answers }) }),
    object({
      ...common,
      type: { const: 'fill_blank' },
      answer: object({
        blanks: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: object({ id: { type: 'string', pattern: '^[1-9][0-9]*$' }, accepted: answers }),
        },
      }),
    }),
  ],
};
const bankText = { ...text, maxLength: 200 };
const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://chagok.local/question-bank.schema.json',
  title: '차곡 문제은행 v1.0 · 고정 규격',
  ...object({
    schema_version: { const: '1.0' },
    bank: object({ id, title: bankText, subject: bankText, unit: bankText }),
    questions: { type: 'array', minItems: 1, maxItems: 2000, items: question },
  }),
};
fs.writeFileSync('public/question-bank.schema.json', JSON.stringify(schema, null, 2) + '\n');
const bank = JSON.parse(fs.readFileSync('public/examples/biology.json', 'utf8'));
for (const type of ['multiple_choice', 'short_answer', 'fill_blank'])
  fs.writeFileSync(
    `public/examples/${type}.json`,
    JSON.stringify(
      {
        ...bank,
        bank: { ...bank.bank, id: `example-${type}` },
        questions: [bank.questions.find((q) => q.type === type)],
      },
      null,
      2,
    ) + '\n',
  );
