import { useState } from 'react';
import { useApp } from '../state/AppContext';
import type { Repository } from '../data/repository';

export function ManageCards({
  title,
  items,
  selected,
  onSelect,
  remove,
  warning,
  action,
  onOpen,
  openLabel = '이어풀기',
}: {
  title: string;
  items: { id: string; title: string; detail: string }[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  remove: (repo: Repository, id: string) => Promise<void>;
  warning: string;
  action: string;
  onOpen?: (id: string) => void;
  openLabel?: string;
}) {
  const { perform, busy } = useApp();
  const [working, setWorking] = useState(false);
  const ids = items.filter((i) => selected.includes(i.id)).map((i) => i.id);
  async function apply() {
    if (!ids.length || !window.confirm(`선택한 ${ids.length}개를 처리할까요? ${warning}`)) return;
    setWorking(true);
    const done = new Set<string>();
    await perform(async (repo) => {
      for (const id of ids) {
        await remove(repo, id);
        done.add(id);
      }
    }, `${ids.length}개 처리했어요.`);
    onSelect(ids.filter((id) => !done.has(id)));
    setWorking(false);
  }
  return (
    <section className="manage-panel panel">
      <h2>{title}</h2>
      {items.length ? (
        <>
          <div className="manage-tools">
            <label>
              <input
                type="checkbox"
                disabled={busy || working}
                checked={ids.length === items.length}
                onChange={(e) => onSelect(e.target.checked ? items.map((i) => i.id) : [])}
              />
              전체 선택
            </label>
            <button
              className="text-link"
              disabled={!ids.length || busy || working}
              onClick={() => void apply()}
            >
              {action} ({ids.length})
            </button>
          </div>
          <div className="manage-grid">
            {items.map((item) => (
              <div className="manage-card" key={item.id}>
                <label>
                  <input
                    type="checkbox"
                    disabled={busy || working}
                    checked={ids.includes(item.id)}
                    onChange={(e) =>
                      onSelect(
                        e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                </label>
                {onOpen && (
                  <button className="text-link" onClick={() => onOpen(item.id)}>
                    {openLabel}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="muted">표시할 항목이 없어요.</p>
      )}
    </section>
  );
}
