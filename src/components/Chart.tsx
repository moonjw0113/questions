import { useId } from 'react';
import { niceTicks, type ChartResult, type ChartSpec } from '../domain/chart';

const W = 480,
  H = 300;
const colors = ['var(--accent)', 'var(--blue)', 'var(--orange)', 'var(--purple)', 'var(--red)'];
const dash = (i: number) => (i >= colors.length ? '6 4' : undefined);
const color = (i: number) => colors[i % colors.length];
const fmt = (v: number) => String(Number(v.toPrecision(6)));

function axis(range: [number, number] | undefined, values: number[], fromZero: boolean) {
  if (range) {
    const ticks = niceTicks(range[0], range[1]).filter(
      (t) => t >= range[0] - 1e-9 && t <= range[1] + 1e-9,
    );
    return { min: range[0], max: range[1], ticks };
  }
  let lo = Math.min(...values),
    hi = Math.max(...values);
  if (fromZero || (lo > 0 && lo <= hi / 2)) lo = Math.min(0, lo);
  if (hi < 0 && fromZero) hi = 0;
  const ticks = niceTicks(lo, hi);
  return { min: ticks[0], max: ticks[ticks.length - 1], ticks };
}

function summary(spec: ChartSpec) {
  const kind = { line: '꺾은선', scatter: '점', bar: '막대' }[spec.type];
  return `${kind} 그래프. 가로축 ${spec.x || '없음'}, 세로축 ${spec.y || '없음'}. ${spec.series
    .map(
      (s) =>
        `${s.name ? s.name + ': ' : ''}${s.points.map((p) => `(${p.x}, ${fmt(p.y)})`).join(' ')}`,
    )
    .join(' / ')}`;
}

/** ```chart 블록을 그린다. 형식 오류면 오류 안내를 보여 준다. */
export function Chart({ chart }: { chart: ChartResult }) {
  const uid = useId();
  if (!chart.spec)
    return <span className="rich-chart-error">그래프를 그릴 수 없어요: {chart.error}</span>;
  const spec = chart.spec;
  const legend = spec.series.length > 1;
  const left = 58,
    right = 18,
    legendRows = legend ? Math.ceil(spec.series.length / 4) : 0,
    top = 18 + legendRows * 18,
    bottom = 52;
  const pw = W - left - right,
    ph = H - top - bottom;
  const ys = spec.series.flatMap((s) => s.points.map((p) => p.y));
  const yAxis = axis(spec.yRange, ys, spec.type === 'bar');
  const sy = (v: number) => top + ph - ((v - yAxis.min) / (yAxis.max - yAxis.min)) * ph;

  let sx: (p: { x: number | string }, i?: number) => number;
  let xTicks: { pos: number; label: string }[];
  let band = 0;
  const categories =
    spec.type === 'bar'
      ? [...new Set(spec.series.flatMap((s) => s.points.map((p) => String(p.x))))]
      : [];
  if (spec.type === 'bar') {
    band = pw / categories.length;
    sx = (p) => left + band * categories.indexOf(String(p.x));
    xTicks = categories.map((c, i) => ({ pos: left + band * (i + 0.5), label: c }));
  } else {
    const xAxis = axis(
      spec.xRange,
      spec.series.flatMap((s) => s.points.map((p) => p.x as number)),
      false,
    );
    sx = (p) => left + (((p.x as number) - xAxis.min) / (xAxis.max - xAxis.min)) * pw;
    xTicks = xAxis.ticks.map((t) => ({ pos: sx({ x: t }), label: fmt(t) }));
  }
  const clipId = `chart-clip-${uid.replace(/:/g, '')}`;
  const label = summary(spec);
  return (
    <span className="rich-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <title>{label}</title>
        <defs>
          <clipPath id={clipId}>
            <rect x={left} y={top - 4} width={pw + 4} height={ph + 8} />
          </clipPath>
        </defs>
        {yAxis.ticks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={left} x2={left + pw} y1={sy(t)} y2={sy(t)} />
            <text
              className="chart-tick"
              x={left - 8}
              y={sy(t)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {fmt(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text
            key={t.label + t.pos}
            className="chart-tick"
            x={t.pos}
            y={top + ph + 18}
            textAnchor="middle"
          >
            {t.label}
          </text>
        ))}
        <line className="chart-axis" x1={left} x2={left + pw} y1={top + ph} y2={top + ph} />
        <line className="chart-axis" x1={left} x2={left} y1={top} y2={top + ph} />
        {spec.x && (
          <text className="chart-label" x={left + pw / 2} y={H - 10} textAnchor="middle">
            {spec.x}
          </text>
        )}
        {spec.y && (
          <text
            className="chart-label"
            transform={`translate(16 ${top + ph / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            {spec.y}
          </text>
        )}
        <g clipPath={`url(#${clipId})`}>
          {spec.series.map((s, i) => {
            if (spec.type === 'bar') {
              const n = spec.series.length,
                w = (band * 0.7) / n;
              return s.points.map((p) => {
                const x = sx(p) + band * 0.15 + w * i,
                  y0 = sy(Math.max(yAxis.min, Math.min(0, yAxis.max))),
                  y1 = sy(p.y);
                return (
                  <rect
                    key={`${i}-${p.x}`}
                    x={x}
                    y={Math.min(y0, y1)}
                    width={w}
                    height={Math.abs(y1 - y0)}
                    fill={color(i)}
                    opacity={i >= colors.length ? 0.6 : 0.9}
                    rx={2}
                  />
                );
              });
            }
            return (
              <g key={i} stroke={color(i)} fill={color(i)}>
                {spec.type === 'line' && (
                  <polyline
                    fill="none"
                    strokeWidth={2.2}
                    strokeDasharray={dash(i)}
                    strokeLinejoin="round"
                    points={s.points.map((p) => `${sx(p)},${sy(p.y)}`).join(' ')}
                  />
                )}
                {s.points.map((p, j) => (
                  <circle key={j} cx={sx(p)} cy={sy(p.y)} r={spec.type === 'scatter' ? 4 : 3.2} />
                ))}
              </g>
            );
          })}
        </g>
        {legend &&
          spec.series.map((s, i) => (
            <g
              key={i}
              transform={`translate(${left + (i % 4) * 105} ${12 + Math.floor(i / 4) * 18})`}
            >
              <line
                x1={0}
                x2={18}
                y1={0}
                y2={0}
                stroke={color(i)}
                strokeWidth={3}
                strokeDasharray={dash(i)}
              />
              <text className="chart-tick" x={24} y={0} dominantBaseline="middle">
                {s.name || `계열 ${i + 1}`}
              </text>
            </g>
          ))}
      </svg>
    </span>
  );
}
