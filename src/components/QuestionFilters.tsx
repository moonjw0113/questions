import { useEffect, useRef } from 'react';
import { ChevronDown, Search } from 'lucide-react';
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
  const dropdownRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node))
        dropdownRef.current.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dropdownRef.current?.open) {
        dropdownRef.current.open = false;
        dropdownRef.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);
  const patch = (p: Partial<Filters>) => onChange({ ...f, ...p });
  const subjects =
    d?.subjects.filter((s) => (!f.subject || s.name === f.subject) && s.units.length) || [];
  const toggleUnit = (subject: string, unit: string) => {
    const selected = f.units.some((item) => item.subject === subject && item.unit === unit);
    patch({
      units: selected
        ? f.units.filter((item) => item.subject !== subject || item.unit !== unit)
        : [...f.units, { subject, unit }],
    });
  };
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
          <select value={f.subject} onChange={(e) => patch({ subject: e.target.value, units: [] })}>
            <option value="">전체 과목</option>
            {d?.subjects.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        <div className="unit-filter">
          <span className="unit-filter-label" id="unit-filter-label">
            단원
          </span>
          <details className="unit-filter-dropdown" ref={dropdownRef}>
            <summary aria-labelledby="unit-filter-label unit-filter-value">
              <span id="unit-filter-value">
                {f.units.length ? `${f.units.length}개 단원 선택` : '전체 단원'}
              </span>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="unit-filter-menu">
              <div className="unit-filter-menu-header">
                <span>공부할 단원을 선택해요</span>
                <button type="button" onClick={() => patch({ units: [] })}>
                  전체 단원
                </button>
              </div>
              <p>선택하지 않으면 전체 단원을 포함해요.</p>
              <div className="unit-filter-list">
                {subjects.map((subject) => (
                  <fieldset key={subject.name}>
                    {!f.subject && <legend>{subject.name}</legend>}
                    {subject.units.map((unit) => (
                      <label key={unit} className="unit-filter-option">
                        <input
                          type="checkbox"
                          checked={f.units.some(
                            (item) => item.subject === subject.name && item.unit === unit,
                          )}
                          onChange={() => toggleUnit(subject.name, unit)}
                        />
                        <span>{unit}</span>
                      </label>
                    ))}
                  </fieldset>
                ))}
                {!subjects.length && (
                  <span className="unit-filter-empty">등록된 단원이 없어요.</span>
                )}
              </div>
              <button
                type="button"
                className="button secondary full unit-filter-done"
                onClick={() => {
                  if (dropdownRef.current) dropdownRef.current.open = false;
                }}
              >
                선택 완료
              </button>
            </div>
          </details>
        </div>
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
