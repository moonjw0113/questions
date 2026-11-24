import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergeBanks } from '../src/domain/merge';
import { normalizeBank, parseBank } from '../src/domain/import';
import { filterQuestions } from '../src/domain/study';
import {
  defaultSettings,
  emptyFilters,
  type AppData,
  type QuestionBank,
} from '../src/domain/types';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as QuestionBank;
const biology = read('public/examples/biology.json');
const science = read('public/examples/science-v1_1.json');
const target = { id: 'merged', title: '합본', subject: '과학', unit: '모음' };

describe('세트 합치기', () => {
  it('문제를 순서대로 이어 붙이고 겹치는 ID는 바꾼다', () => {
    const { bank, renamed } = mergeBanks(
      [
        { name: 'a.json', bank: biology },
        { name: 'b.json', bank: biology },
      ],
      target,
    );
    expect(bank.bank).toEqual(target);
    expect(bank.questions).toHaveLength(biology.questions.length * 2);
    expect(new Set(bank.questions.map((q) => q.id)).size).toBe(bank.questions.length);
    expect(renamed).toHaveLength(biology.questions.length);
    expect(renamed[0]).toEqual({
      source: 'b.json',
      from: biology.questions[0].id,
      to: `${biology.questions[0].id}-2`,
    });
    expect(parseBank(JSON.stringify(bank)).errors).toEqual([]);
    // 원본은 바꾸지 않는다.
    expect(biology.questions[0].id).not.toContain('-2');
  });
  it('하나라도 v1.1이면 v1.1로 만들고 그대로 가져올 수 있다', () => {
    const { bank } = mergeBanks(
      [
        { name: 'bio', bank: biology },
        { name: 'sci', bank: science },
      ],
      target,
    );
    expect(bank.schema_version).toBe('1.1');
    expect(parseBank(JSON.stringify(bank)).errors).toEqual([]);
    expect(mergeBanks([{ name: 'bio', bank: biology }], target).bank.schema_version).toBe('1.0');
  });
});

describe('수정·삭제 예정 필터', () => {
  it('표시(메모)가 있는 문제만 고른다', () => {
    const qs = normalizeBank(biology).questions;
    const d: AppData = {
      subjects: [],
      banks: [],
      entries: qs.map((q, i) => ({
        id: q.id,
        bankId: biology.bank.id,
        currentVersion: 1,
        favorite: false,
        archived: false,
        report: i === 0 ? '수정·삭제 예정' : '',
      })),
      versions: qs.map((question) => ({ bankId: biology.bank.id, question })),
      attempts: [],
      sessions: [],
      progress: [],
      settings: { ...defaultSettings },
    };
    expect(filterQuestions(d, { ...emptyFilters, scope: 'flagged' }).map((q) => q.id)).toEqual([
      qs[0].id,
    ]);
  });
});
