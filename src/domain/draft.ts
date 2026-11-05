/** Drafts are device-local; the server remains authoritative for submitted answers. */
export function readDraft(storage: Storage, key: string, base: string[]): string[] | null {
  try {
    const draft: unknown = JSON.parse(storage.getItem(key) || 'null');
    if (!draft || typeof draft !== 'object') return null;
    const value = draft as { base?: unknown; value?: unknown };
    if (!Array.isArray(value.value) || !value.value.every((item) => typeof item === 'string'))
      return null;
    return JSON.stringify(value.base) === JSON.stringify(base) ? value.value : null;
  } catch {
    return null;
  }
}

export function writeDraft(storage: Storage, key: string, base: string[], value: string[]) {
  if (JSON.stringify(base) === JSON.stringify(value)) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify({ base, value }));
}
