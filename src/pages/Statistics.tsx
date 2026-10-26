import { useState } from 'react';
import { Download, Target, CheckCircle2, Clock3, Flame, ArrowRight, Lightbulb } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { getStats, groupStats, percentage } from '../domain/statistics';
import { typeLabels, type QuestionType } from '../domain/types';
import { Empty, Progress, SectionTitle } from '../components/ui';
export function Statistics({
  exportResults,
  start,
}: {
  exportResults: () => void;
  start: (subject?: string, review?: boolean) => void;
}) {
  const { data: d } = useApp();
  const [range, setRange] = useState('all'),
    [group, setGroup] = useState<'subject' | 'unit' | 'type'>('subject');
  if (!d) return null;
  const stats = getStats(d),
    attempts = d.attempts
      .filter(
        (a) => range === 'all' || Date.parse(a.answeredAt) >= Date.now() - Number(range) * 86400000,
      )
      .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt)),
    groups = groupStats(d, attempts, group),
    weak = groupStats(d, attempts.slice(-100), 'tags').filter((s) => s.accuracy < 80);
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">LOOK HOW FAR YOU'VE COME</span>
          <h1>공부의 흔적, 성장의 기록</h1>
          <p>잘하고 있는 것과 한 번 더 볼 것을 함께 확인해요.</p>
        </div>
        <button className="button primary" onClick={exportResults}>
          <Download size={17} />
          학습 결과 내보내기
        </button>
      </div>
      <div className="stats-range">
        <div className="segmented small">
          {[
            ['all', '전체 기간'],
            ['7', '최근 7일'],
            ['30', '최근 30일'],
          ].map(([k, v]) => (
            <button className={range === k ? 'active' : ''} key={k} onClick={() => setRange(k)}>
              {v}
            </button>
          ))}
        </div>
        <span className="muted">정답률은 빈칸 부분 점수를 포함해요.</span>
      </div>
      <div className="stat-cards">
        <div className="stat-card panel">
          <span className="metric-icon green">
            <CheckCircle2 size={21} />
          </span>
          <span>누적 풀이</span>
          <strong>
            {attempts.length}
            <small>회</small>
          </strong>
        </div>
        <div className="stat-card panel">
          <span className="metric-icon blue">
            <Target size={21} />
          </span>
          <span>전체 정답률</span>
          <strong>
            {percentage(attempts.map((a) => a.score))}
            <small>%</small>
          </strong>
          <small>최근 30회 {percentage(attempts.slice(-30).map((a) => a.score))}%</small>
        </div>
        <div className="stat-card panel">
          <span className="metric-icon orange">
            <Clock3 size={21} />
          </span>
          <span>집중한 시간</span>
          <strong>
            {Math.round(attempts.reduce((s, a) => s + a.durationMs, 0) / 60000)}
            <small>분</small>
          </strong>
        </div>
        <div className="stat-card panel">
          <span className="metric-icon purple">
            <Flame size={21} />
          </span>
          <span>연속 학습</span>
          <strong>
            {stats.streak}
            <small>일</small>
          </strong>
          <small>전체 기록 기준</small>
        </div>
      </div>
      {!attempts.length ? (
        <Empty
          title="성장의 기록이 기다리고 있어요"
          description="첫 학습을 마치면 나의 공부 패턴을 확인할 수 있어요."
          action={
            <button className="button primary" onClick={() => start()}>
              공부 시작하기
            </button>
          }
        />
      ) : (
        <>
          <div className="stats-main-grid">
            <section className="panel chart-panel">
              <SectionTitle title="매일의 학습량" subtitle="최근 7일 동안 남긴 발자국이에요" />
              <div className="large-bar-chart">
                {stats.days.map((day, i) => (
                  <div key={day.date}>
                    <strong>{day.count}</strong>
                    <div className="large-bar-space">
                      <span
                        className={i === 6 ? 'current' : ''}
                        style={{
                          height: `${Math.max(3, (day.count / Math.max(1, ...stats.days.map((d) => d.count))) * 150)}px`,
                        }}
                      />
                    </div>
                    <span>{day.date.slice(5).replace('-', '/')}</span>
                    <small>{day.label}</small>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel breakdown-panel">
              <SectionTitle title="어떤 공부가 쌓였을까요?" />
              <div className="segmented small">
                {(
                  [
                    ['subject', '과목별'],
                    ['unit', '단원별'],
                    ['type', '유형별'],
                  ] as const
                ).map(([k, v]) => (
                  <button
                    className={group === k ? 'active' : ''}
                    key={k}
                    onClick={() => setGroup(k)}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="breakdown-list">
                {groups.map((g) => (
                  <div key={g.name}>
                    <div className="breakdown-heading">
                      <strong>
                        {group === 'type' ? typeLabels[g.name as QuestionType] : g.name}
                      </strong>
                      <span>
                        {g.accuracy}% <small>· {g.attempts}회</small>
                      </span>
                    </div>
                    <Progress value={g.accuracy} />
                  </div>
                ))}
              </div>
            </section>
          </div>
          <section className="panel weak-panel">
            <SectionTitle
              title="한 번 더 보면 좋을 개념"
              subtitle="선택한 범위의 최근 100회 답안을 바탕으로 살펴봤어요"
              action={
                <span className="metric-icon orange">
                  <Lightbulb size={21} />
                </span>
              }
            />
            {weak.length ? (
              <div className="weak-concepts">
                {weak.slice(0, 8).map((w) => (
                  <div key={w.name}>
                    <span className="concept-dot" />
                    <div>
                      <strong>{w.name}</strong>
                      <small>
                        {w.attempts}회 학습 · 정답률 {w.accuracy}%
                        {w.attempts < 3 ? ' · 표본 부족' : ''}
                      </small>
                    </div>
                    <button className="text-link" onClick={() => start(undefined, true)}>
                      복습하기
                      <ArrowRight size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="notice">
                현재 범위에서 정답률 80% 미만의 개념이 없어요. 새로운 변형 문제로 이해를 확인해
                보세요.
              </p>
            )}
            <p className="footnote">
              문항 숙련도는 반복 회상을 나타냅니다. 개념 이해도는 새로운 문제를 통해 함께 확인해
              주세요.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
