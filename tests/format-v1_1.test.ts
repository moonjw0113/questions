import { describe, it, expect, beforeEach } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import {
  parseBank,
  normalizeBank,
  inspectImport,
  schemaVersionOf,
  toBankFile,
  toImportQuestion,
} from '../src/domain/import';
import { parseRich, parseInline, splitRow } from '../src/domain/richText';
import { analysisExport } from '../src/domain/statistics';
import { createSession } from '../src/domain/study';
import { DemoRepository, validateBackup } from '../src/data/repository';
import { defaultSettings, type AppData, type QuestionBank } from '../src/domain/types';

const read = (path: string) => readFileSync(path, 'utf8');
const science = JSON.parse(read('public/examples/science-v1_1.json')) as QuestionBank;
const biology = JSON.parse(read('public/examples/biology.json')) as QuestionBank;

describe('문제 형식 v1.0 · v1.1 동시 지원', () => {
  it('v1.1 예제와 v1.0 예제를 각자 맞는 스키마로 통과시킨다', () => {
    expect(parseBank(read('public/examples/science-v1_1.json')).errors).toEqual([]);
    expect(parseBank(read('public/examples/biology.json')).errors).toEqual([]);
  });
  it('v1.1 스키마는 v1.0 스키마에 statements만 더했다', () => {
    const v10 = JSON.parse(read('public/question-bank.schema.json'));
    const v11 = JSON.parse(read('public/question-bank.v1.1.schema.json'));
    expect(v11.properties.schema_version).toEqual({ const: '1.1' });
    v11.properties.questions.items.oneOf.forEach(
      (item: { properties: Record<string, unknown> }, i: number) => {
        const old = v10.properties.questions.items.oneOf[i];
        expect(Object.keys(item.properties).filter((k) => !(k in old.properties))).toEqual([
          'statements',
        ]);
      },
    );
  });
  it('v1.0 파일의 statements, 모르는 버전은 거절한다', () => {
    const old = structuredClone(science);
    old.schema_version = '1.0';
    expect(parseBank(JSON.stringify(old)).errors.length).toBeGreaterThan(0);
    delete old.questions[0].statements;
    expect(parseBank(JSON.stringify(old)).errors).toEqual([]);
    expect(parseBank(JSON.stringify({ ...science, schema_version: '2.0' })).errors[0]).toMatch(
      '지원하지 않는 형식 버전',
    );
  });
  it('v1.1 문제는 서식·보기 정보를 갖고, v1.0 문제는 그대로다', () => {
    const [mc] = normalizeBank(science).questions;
    expect(mc.rich).toBe(true);
    expect(mc.statements).toHaveLength(3);
    expect(mc.source).toBe('JSON 가져오기 · v1.1');
    const plain = normalizeBank(biology).questions[0];
    expect(plain.rich).toBeUndefined();
    expect(plain.statements).toBeUndefined();
  });
  it('내보낼 때 서식 문제가 있으면 v1.1, 없으면 v1.0이고 다시 가져올 수 있다', () => {
    const sci = normalizeBank(science).questions,
      bio = normalizeBank(biology).questions;
    expect(schemaVersionOf(sci)).toBe('1.1');
    expect(schemaVersionOf(bio)).toBe('1.0');
    for (const [bank, qs] of [
      [science.bank, sci],
      [biology.bank, bio],
    ] as const) {
      const file = toBankFile(bank, qs);
      expect(parseBank(JSON.stringify(file)).errors).toEqual([]);
      expect(file).toEqual(bank === science.bank ? science : biology);
    }
  });
  it('같은 내용이라도 v1.0으로 다시 가져오면 새 버전으로 본다', () => {
    const repoData = { ...emptyData() };
    const first = normalizeBank(science, repoData);
    repoData.versions = first.questions.map((question) => ({ bankId: science.bank.id, question }));
    repoData.entries = first.questions.map((q) => ({
      id: q.id,
      bankId: science.bank.id,
      currentVersion: 1,
      favorite: false,
      archived: false,
      report: '',
    }));
    repoData.banks = [{ ...science.bank, createdAt: new Date().toISOString() }];
    expect(inspectImport(science, repoData)).toMatchObject({ skipped: 4, updated: 0 });
    const asOld = structuredClone(science);
    asOld.schema_version = '1.0';
    asOld.questions.forEach((q) => delete q.statements);
    expect(inspectImport(asOld, repoData)).toMatchObject({ skipped: 0, updated: 4 });
  });
  it('〈보기〉형 선택지는 선택지 섞기 설정과 관계없이 순서를 지킨다', () => {
    const [mc] = normalizeBank(science).questions,
      d = emptyData();
    const order = () => Object.values(createSession(d, [mc], 'learn', 1).choiceOrders)[0];
    for (let i = 0; i < 10; i++) expect(order()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
  it('학습 결과 파일에서는 보기를 본문에 붙여 v1.0 규격을 지킨다', () => {
    const [mc] = normalizeBank(science).questions;
    const flat = toImportQuestion(mc, { flatten: true });
    expect(flat.statements).toBeUndefined();
    expect(flat.prompt).toContain('〈보기〉\nㄱ. (가)는 산성이다.\nㄴ.');
    const d = emptyData();
    d.banks = [{ ...science.bank, createdAt: new Date().toISOString() }];
    d.versions = [{ bankId: science.bank.id, question: mc }];
    d.entries = [
      {
        id: mc.id,
        bankId: science.bank.id,
        currentVersion: 1,
        favorite: false,
        archived: false,
        report: '',
      },
    ];
    d.attempts = [
      {
        id: 'a1',
        sessionId: 's',
        questionId: mc.id,
        questionVersion: 1,
        answer: ['C'],
        durationMs: 1000,
        mode: 'learn',
        answeredAt: new Date().toISOString(),
        attemptNumber: 1,
        manual: false,
        score: 1,
        correct: true,
        partial: false,
        blankResults: [true],
      },
    ];
    const output = analysisExport(d, { period: 'all', subject: '', unit: '' });
    const validate = new Ajv({ strict: false, allErrors: true }).compile(
      JSON.parse(read('public/study-result.schema.json')),
    );
    expect(validate(output), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe('체험 저장소의 v1.1 문제', () => {
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
  it('가져오기, 중복 건너뛰기, 백업 검사와 복원까지 보기를 유지한다', async () => {
    const repo = new DemoRepository();
    expect(await repo.importBank(science)).toMatchObject({ added: 4 });
    expect(await repo.importBank(science)).toMatchObject({ skipped: 4 });
    const d = await repo.load();
    const q = d.versions.find((v) => v.bankId === science.bank.id)!.question;
    expect(q.rich).toBe(true);
    expect(() => validateBackup(structuredClone(d))).not.toThrow();
    await repo.restore(structuredClone(d));
    const after = await repo.load();
    expect(after.versions.find((v) => v.question.id === q.id)!.question.statements).toEqual(
      q.statements,
    );
  });
});

describe('서식 텍스트 해석', () => {
  it('줄 안 수식, 굵게, \\$ 와 짝 없는 기호', () => {
    expect(parseInline('넓이는 $\\pi r^2$이고 **중요**, 가격 \\$5, 남은 $ 기호')).toEqual([
      { kind: 'text', text: '넓이는 ' },
      { kind: 'math', tex: '\\pi r^2' },
      { kind: 'text', text: '이고 ' },
      { kind: 'bold', children: [{ kind: 'text', text: '중요' }] },
      { kind: 'text', text: ', 가격 $5, 남은 $ 기호' },
    ]);
  });
  it('빈칸은 요청할 때만 해석한다', () => {
    expect(parseInline('답은 {{1}}', { blanks: true })).toEqual([
      { kind: 'text', text: '답은 ' },
      { kind: 'blank', id: '1' },
    ]);
    expect(parseInline('답은 {{1}}')).toEqual([{ kind: 'text', text: '답은 {{1}}' }]);
  });
  it('표, 정렬, 수식 속 | 를 처리한다', () => {
    expect(splitRow('| $|x|$ | a\\|b | c |')).toEqual(['$|x|$', 'a|b', 'c']);
    const [intro, table, outro] = parseRich(
      '표를 보자.\n| 물질 | 값 |\n|:---|---:|\n| 물 | $18$ |\n끝',
    );
    expect(intro).toEqual({ kind: 'para', lines: [[{ kind: 'text', text: '표를 보자.' }]] });
    expect(table).toMatchObject({
      kind: 'table',
      align: ['left', 'right'],
      head: [[{ kind: 'text', text: '물질' }], [{ kind: 'text', text: '값' }]],
      rows: [[[{ kind: 'text', text: '물' }], [{ kind: 'math', tex: '18' }]]],
    });
    expect(outro).toEqual({ kind: 'para', lines: [[{ kind: 'text', text: '끝' }]] });
  });
  it('따로 한 줄 수식은 한 줄 또는 여러 줄로 쓸 수 있다', () => {
    expect(parseRich('$$\\ce{H2O}$$')).toEqual([{ kind: 'math', tex: '\\ce{H2O}' }]);
    expect(parseRich('위\n$$\na + b\n= c\n$$\n아래')).toEqual([
      { kind: 'para', lines: [[{ kind: 'text', text: '위' }]] },
      { kind: 'math', tex: 'a + b\n= c' },
      { kind: 'para', lines: [[{ kind: 'text', text: '아래' }]] },
    ]);
  });
  it('빈 줄로 문단을 나누고 줄바꿈은 같은 문단에 둔다', () => {
    expect(parseRich('가\n나\n\n다').map((b) => b.kind === 'para' && b.lines.length)).toEqual([
      2, 1,
    ]);
  });
});

function emptyData(): AppData {
  return {
    subjects: [],
    banks: [],
    entries: [],
    versions: [],
    attempts: [],
    sessions: [],
    progress: [],
    settings: { ...defaultSettings },
  };
}
