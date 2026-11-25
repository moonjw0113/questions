import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { DemoRepository } from '../src/data/repository';
import type { QuestionBank } from '../src/domain/types';

const example = JSON.parse(readFileSync('public/examples/biology.json', 'utf8')) as QuestionBank;

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

describe('체험 저장소 세트 삭제', () => {
  it('비게 된 단원과 과목도 지우고, 같은 단원을 쓰는 세트가 있으면 남긴다', async () => {
    const repo = new DemoRepository();
    const make = (id: string, unit: string) => {
      const b = structuredClone(example);
      b.bank = { id, title: id, subject: '정리과목', unit };
      return b;
    };
    await repo.importBank(make('tidy-a', '단원1'));
    await repo.importBank(make('tidy-b', '단원2'));
    await repo.importBank(make('tidy-c', '단원2'));
    const units = async () =>
      (await repo.load()).subjects.find((s) => s.name === '정리과목')?.units;
    await repo.purgeContent('tidy-a');
    expect(await units()).toEqual(['단원2']);
    await repo.purgeContent('tidy-b');
    expect(await units()).toEqual(['단원2']);
    await repo.purgeContent('tidy-c');
    expect(await units()).toBeUndefined();
  });
});

describe('체험 저장소 세트 업데이트', () => {
  it('새 파일에 없는 문제만 지우고 나머지는 그대로 둔다', async () => {
    const repo = new DemoRepository();
    const bank = structuredClone(example);
    bank.bank.id = 'update-bank';
    await repo.importBank(bank);
    const keep = bank.questions.slice(0, 2).map((q) => q.id);
    expect(await repo.removeMissing('update-bank', keep)).toBe(bank.questions.length - 2);
    const left = (await repo.load()).entries.filter((e) => e.bankId === 'update-bank');
    expect(left.map((e) => e.id).sort()).toEqual(keep.map((id) => `update-bank::${id}`).sort());
    await expect(repo.removeMissing('update-bank', [])).rejects.toThrow('남길 문제');
  });
});
