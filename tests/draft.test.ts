import { describe, expect, it } from 'vitest';
import { readDraft, writeDraft } from '../src/domain/draft';

function storage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('answer drafts', () => {
  it('restores unfinished answers and discards a draft after its saved answer changes', () => {
    const store = storage();
    writeDraft(store, 'user:session:question', ['원래 답'], ['새 답']);
    expect(readDraft(store, 'user:session:question', ['원래 답'])).toEqual(['새 답']);
    expect(readDraft(store, 'user:session:question', ['다른 기기의 답'])).toBeNull();
    expect(readDraft(store, 'other:session:question', ['원래 답'])).toBeNull();
    writeDraft(store, 'user:session:question', ['새 답'], ['새 답']);
    expect(readDraft(store, 'user:session:question', ['새 답'])).toBeNull();
  });
  it('ignores damaged or invalid drafts', () => {
    const store = storage();
    store.setItem('draft', '{');
    expect(readDraft(store, 'draft', [])).toBeNull();
    store.setItem('draft', JSON.stringify({ base: [], value: [123] }));
    expect(readDraft(store, 'draft', [])).toBeNull();
  });
});
