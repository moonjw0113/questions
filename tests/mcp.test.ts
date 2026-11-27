import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { createMcpHandler, tokenFromUrl, type CallDb } from '../src/mcp/server';
import { normalizeBank } from '../src/domain/import';
import { defaultSettings, type AppData, type QuestionBank } from '../src/domain/types';

const token = 'tok_' + 'Z9y8'.repeat(10);
const base = `https://example.supabase.co/functions/v1/chagok-mcp/${token}`;
const science = JSON.parse(
  readFileSync('public/examples/science-v1_1.json', 'utf8'),
) as QuestionBank;

function fakeDb(reports: string[] = []) {
  const bank = normalizeBank(science);
  const data: AppData = {
    subjects: [{ name: science.bank.subject, units: [science.bank.unit] }],
    banks: [{ ...science.bank, createdAt: '2026-11-01T00:00:00.000Z' }],
    entries: bank.questions.map((q, i) => ({
      id: q.id,
      bankId: science.bank.id,
      currentVersion: 1,
      favorite: false,
      archived: false,
      report: reports[i] || '',
    })),
    versions: bank.questions.map((question) => ({ bankId: science.bank.id, question })),
    attempts: [
      {
        id: 'a1',
        sessionId: 's1',
        questionId: bank.questions[0].id,
        questionVersion: 1,
        answer: ['A'],
        durationMs: 5000,
        mode: 'learn',
        answeredAt: '2026-11-20T00:00:00.000Z',
        attemptNumber: 1,
        manual: false,
        score: 0,
        correct: false,
        partial: false,
        blankResults: [false],
      },
    ],
    sessions: [],
    progress: [],
    settings: { ...defaultSettings },
  };
  const calls: { token: string; action: string; args?: unknown }[] = [];
  const callDb: CallDb = async (t, action, args) => {
    calls.push({ token: t, action, args });
    if (action === 'load') return structuredClone(data);
    if (action === 'remove_missing') return 2;
    if (action === 'purge') return 1;
    return { added: 1, updated: 0, skipped: 0 };
  };
  return { calls, handler: createMcpHandler(callDb) };
}

const post = (handler: (r: Request) => Promise<Response>, body: unknown, url = base) =>
  handler(new Request(url, { method: 'POST', body: JSON.stringify(body) }));
const rpc = async (handler: (r: Request) => Promise<Response>, method: string, params?: unknown) =>
  (await (await post(handler, { jsonrpc: '2.0', id: 1, method, params })).json()) as any;
const call = async (handler: (r: Request) => Promise<Response>, name: string, args = {}) =>
  (await rpc(handler, 'tools/call', { name, arguments: args })).result as {
    content: { text: string }[];
    isError?: boolean;
  };

describe('Claude 커넥터(MCP)', () => {
  it('주소에서 토큰을 읽고, 토큰 없는 주소는 거절한다', async () => {
    expect(tokenFromUrl(base)).toBe(token);
    expect(tokenFromUrl(base + '/')).toBe(token);
    expect(tokenFromUrl('https://x/functions/v1/chagok-mcp')).toBe('');
    expect(tokenFromUrl('https://x/functions/v1/chagok-mcp/short')).toBe('');
    const { handler } = fakeDb();
    expect((await post(handler, {}, 'https://x.supabase.co/functions/v1/chagok-mcp')).status).toBe(
      404,
    );
    expect((await handler(new Request(base))).status).toBe(405);
  });
  it('초기화, 알림, 도구 목록', async () => {
    const { handler } = fakeDb();
    const init = await rpc(handler, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'chagok' },
    });
    expect(
      (await rpc(handler, 'initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion,
    ).toBe('2025-06-18');
    const note = await post(handler, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(note.status).toBe(202);
    const list = await rpc(handler, 'tools/list');
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'get_question_format',
      'list_question_banks',
      'get_question_bank',
      'list_flagged_questions',
      'import_question_bank',
      'delete_questions',
      'get_study_result',
    ]);
    expect((await rpc(handler, 'nope')).error.code).toBe(-32601);
    expect((await rpc(handler, 'tools/call', { name: 'nope' })).error.code).toBe(-32602);
  });
  it('형식·목록·은행 내용을 돌려준다', async () => {
    const { handler, calls } = fakeDb();
    expect((await call(handler, 'get_question_format')).content[0].text).toContain(
      'question-bank v1.1 JSON 스키마',
    );
    const list = JSON.parse((await call(handler, 'list_question_banks')).content[0].text);
    expect(list.banks).toEqual([
      expect.objectContaining({ id: science.bank.id, questions: 4, schema_version: '1.1' }),
    ]);
    const bank = JSON.parse(
      (await call(handler, 'get_question_bank', { bank_id: science.bank.id })).content[0].text,
    );
    expect(bank).toEqual({
      ...science,
      questions: [...science.questions].sort((a, b) => a.id.localeCompare(b.id)),
    });
    expect((await call(handler, 'get_question_bank', { bank_id: 'none' })).isError).toBe(true);
    expect(calls.every((c) => c.token === token)).toBe(true);
  });
  it('문제를 검사한 뒤에만 저장한다', async () => {
    const { handler, calls } = fakeDb();
    const bad = structuredClone(science);
    bad.questions[0].answer = { option_id: 'Z' } as never;
    const rejected = await call(handler, 'import_question_bank', { bank: bad });
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0].text).toContain('answer.option_id');
    const moved = structuredClone(science);
    moved.bank.unit = '다른 단원';
    expect((await call(handler, 'import_question_bank', { bank: moved })).isError).toBe(true);
    expect(calls.some((c) => c.action === 'import')).toBe(false);
    const ok = await call(handler, 'import_question_bank', { bank: science });
    expect(ok.isError).toBeUndefined();
    expect(ok.content[0].text).toContain('새 문제 1개');
    expect(calls.find((c) => c.action === 'import')?.args).toEqual(science);
  });
  it('수정·삭제 예정 문제를 메모와 함께, 바로 다시 저장할 수 있는 형식으로 준다', async () => {
    const empty = await call(fakeDb().handler, 'list_flagged_questions');
    expect(empty.content[0].text).toContain('표시한 문제가 없어요');
    const { handler } = fakeDb(['', '수정·삭제 예정', '해설이 교과서와 다름']);
    const out = (await call(handler, 'list_flagged_questions')).content[0].text;
    expect(out).toContain('# 수정·삭제 예정 2문제');
    const [entry] = JSON.parse(out.slice(out.indexOf('\n[')));
    expect(entry.file.questions.map((q: { id: string }) => q.id).sort()).toEqual(
      [science.questions[1].id, science.questions[2].id].sort(),
    );
    expect(entry.notes).toContainEqual({
      id: science.questions[2].id,
      memo: '해설이 교과서와 다름',
    });
    expect(entry.notes).toContainEqual({
      id: science.questions[1].id,
      memo: '(메모 없음 · 내용 전체 검토)',
    });
    // 받은 그대로 다시 저장할 수 있다.
    const saved = await call(handler, 'import_question_bank', { bank: entry.file });
    expect(saved.isError).toBeUndefined();
    expect((await call(handler, 'list_flagged_questions', { bank_id: '없는-세트' })).isError).toBe(
      true,
    );
  });
  it('빠진 문제는 요청할 때만 지우고, 지정한 문제를 지울 수 있다', async () => {
    const { handler, calls } = fakeDb();
    const partial = structuredClone(science);
    partial.questions = partial.questions.slice(0, 2);
    const kept = await call(handler, 'import_question_bank', { bank: partial });
    expect(kept.content[0].text).toContain('이 파일에 없는 기존 문제 2개');
    expect(calls.some((c) => c.action === 'remove_missing')).toBe(false);
    const removed = await call(handler, 'import_question_bank', {
      bank: partial,
      remove_missing: true,
    });
    expect(removed.content[0].text).toContain('빠진 문제 삭제 2개');
    expect(calls.find((c) => c.action === 'remove_missing')?.args).toEqual({
      bank: science.bank.id,
      keep: partial.questions.map((q) => q.id),
    });
    const ids = [science.questions[0].id];
    const del = await call(handler, 'delete_questions', {
      bank_id: science.bank.id,
      question_ids: ids,
    });
    expect(del.isError).toBeUndefined();
    expect(calls.find((c) => c.action === 'purge')?.args).toEqual({
      bank: science.bank.id,
      questions: ids,
    });
    const unknown = await call(handler, 'delete_questions', {
      bank_id: science.bank.id,
      question_ids: ['없는-문제'],
    });
    expect(unknown).toMatchObject({ isError: true });
    expect(calls.filter((c) => c.action === 'purge')).toHaveLength(1);
    expect(
      (await call(handler, 'delete_questions', { bank_id: science.bank.id, question_ids: [] }))
        .isError,
    ).toBe(true);
  });
  it('study_result는 규격에 맞고, DB 오류는 도구 오류로 알린다', async () => {
    const { handler } = fakeDb();
    const textOut = (await call(handler, 'get_study_result', { period: 'wrong' })).content[0].text;
    const result = JSON.parse(textOut.slice(textOut.indexOf('# study_result\n') + 15));
    const validate = new Ajv({ strict: false, allErrors: true }).compile(
      JSON.parse(readFileSync('public/study-result.schema.json', 'utf8')),
    );
    expect(validate(result), JSON.stringify(validate.errors)).toBe(true);
    expect(result.summary.attempts).toBe(1);
    const broken = createMcpHandler(async () => {
      throw Error('차곡 연결 주소가 올바르지 않거나 끊어졌습니다.');
    });
    const out = await call(broken, 'list_question_banks');
    expect(out).toMatchObject({ isError: true });
    expect(out.content[0].text).toContain('연결 주소');
  });
  it('여러 메시지를 한 번에 보내도 답한다', async () => {
    const { handler } = fakeDb();
    const res = await post(handler, [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    const out = await res.json();
    expect(out.map((m: { id: number }) => m.id)).toEqual([1, 2]);
  });
});
