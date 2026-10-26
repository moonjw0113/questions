import { Search } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { type Filters, typeLabels } from '../domain/types';
export function QuestionFilters({
  value: f,
  onChange,
  search = false,
}: {
  value: Filters;
  onChange: (value: Filters) => void;
  search?: boolean;
}) {
  const { data: d } = useApp();
  const patch = (p: Partial<Filters>) => onChange({ ...f, ...p });
  const units = [
    ...new Set(
      d?.subjects.filter((s) => !f.subject || s.name === f.subject).flatMap((s) => s.units),
    ),
  ];
  return (
    <div className="filter-box">
      {search && (
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="문제 검색"
            placeholder="문제, 개념, 태그를 검색해 보세요"
            value={f.search}
            onChange={(e) => patch({ search: e.target.value })}
          />
        </label>
      )}
      <div className="filter-grid">
        <label>
          과목
          <select value={f.subject} onChange={(e) => patch({ subject: e.target.value, unit: '' })}>
            <option value="">전체 과목</option>
            {d?.subjects.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        <label>
          단원
          <select value={f.unit} onChange={(e) => patch({ unit: e.target.value })}>
            <option value="">전체 단원</option>
            {units?.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
        <label>
          문제 유형
          <select value={f.type} onChange={(e) => patch({ type: e.target.value })}>
            <option value="">전체 유형</option>
            {Object.entries(typeLabels).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          난이도
          <select value={f.difficulty} onChange={(e) => patch({ difficulty: e.target.value })}>
            <option value="">모든 난이도</option>
            <option value="1">기본</option>
            <option value="2">보통</option>
            <option value="3">심화</option>
          </select>
        </label>
      </div>
      <div className="filter-pills">
        {(
          [
            ['all', '전체 문제'],
            ['wrong', '최근에 틀린 문제'],
            ['due', '복습 예정'],
            ['favorite', '즐겨찾기'],
          ] as const
        ).map(([k, v]) => (
          <button
            key={k}
            className={`pill ${f.scope === k ? 'active' : ''}`}
            onClick={() => patch({ scope: k })}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
