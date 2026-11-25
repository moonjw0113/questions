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
