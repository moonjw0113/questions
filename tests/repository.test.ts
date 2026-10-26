import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn() }));
vi.mock('../src/data/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
import { SupabaseRepository } from '../src/data/repository';
import example from '../public/examples/biology.json';
import type { QuestionBank } from '../src/domain/types';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: {}, error: null });
  mocks.eq.mockResolvedValue({ error: null });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.from.mockReturnValue({ update: mocks.update });
});
describe('공식 Supabase 클라이언트 연결', () => {
  it('외부 결합 키와 내부 UUID를 혼동하지 않고 메타데이터 수정', async () => {
    await new SupabaseRepository().updateQuestion('biology::q1', { favorite: true });
    expect(mocks.from).toHaveBeenCalledWith('questions');
    expect(mocks.eq).toHaveBeenCalledWith('key', 'biology::q1');
  });
  it('고정 JSON 원본을 서버 RPC에 전달', async () => {
    await new SupabaseRepository().importBank(example as QuestionBank);
    expect(mocks.rpc).toHaveBeenCalledWith('import_question_bank', { p_bank: example });
  });
  it('서버 오류를 상위 화면으로 전달', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'RLS denied' } });
    await expect(new SupabaseRepository().load()).rejects.toThrow('RLS denied');
  });
});
