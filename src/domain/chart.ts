// v1.1 서식 글 속 ```chart 블록. 따옴표 없이 쓸 수 있게 한 줄에 한 항목씩 적는다.
//
// ```chart
// type: line            (line·꺾은선 / scatter·점 / bar·막대)
// x: 넣은 NaOH 수용액의 부피 (mL)
// y: 온도 (℃)
// xrange: 0 40          (선택)
// yrange: 15 30         (선택)
// series 온도: 0, 20; 10, 23; 20, 26
// ```
export type ChartType = 'line' | 'scatter' | 'bar';
export interface ChartSeries {
  name: string;
  points: { x: number | string; y: number }[];
}
export interface ChartSpec {
  type: ChartType;
  x: string;
  y: string;
  xRange?: [number, number];
  yRange?: [number, number];
  series: ChartSeries[];
}
export type ChartResult =
  { spec: ChartSpec; error?: undefined } | { error: string; spec?: undefined };

const types: Record<string, ChartType> = {
  line: 'line',
  꺾은선: 'line',
  scatter: 'scatter',
  점: 'scatter',
  bar: 'bar',
  막대: 'bar',
};
const num = (s: string) =>
  /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s.trim()) ? Number(s) : NaN;

export function parseChart(body: string): ChartResult {
  let type: ChartType | undefined;
  let x = '',
    y = '';
  let xRange: [number, number] | undefined, yRange: [number, number] | undefined;
  const raw: { name: string; text: string }[] = [];
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const m = /^\s*([^:]+?)\s*:\s*(.*)$/.exec(line);
    if (!m) return { error: `"${line.trim()}" 줄은 "항목: 값" 형식이어야 해요.` };
    const key = m[1].trim(),
      value = m[2].trim();
    const lower = key.toLowerCase();
    if (lower === 'type') {
      type = types[value.toLowerCase()];
      if (!type) return { error: `type은 line, scatter, bar 중 하나예요. (${value})` };
    } else if (lower === 'x') x = value;
    else if (lower === 'y') y = value;
    else if (lower === 'xrange' || lower === 'yrange') {
      const [a, b, ...rest] = value.split(/[\s,~]+/).map(num);
      if (rest.length || !(a < b)) return { error: `${key}는 "최솟값 최댓값"으로 적어 주세요.` };
      if (lower === 'xrange') xRange = [a, b];
      else yRange = [a, b];
    } else if (lower === 'series' || lower.startsWith('series ')) {
      raw.push({ name: key.slice(6).trim(), text: value });
    } else return { error: `알 수 없는 항목이에요: ${key}` };
  }
  if (!type) return { error: 'type 항목이 필요해요.' };
  if (!raw.length) return { error: 'series 항목이 하나 이상 필요해요.' };
  if (raw.length > 8) return { error: 'series는 8개까지 쓸 수 있어요.' };
  const series: ChartSeries[] = [];
  for (const s of raw) {
    const points: ChartSeries['points'] = [];
    for (const p of s.text.split(';').filter((p) => p.trim())) {
      const parts = p.split(',');
      if (parts.length !== 2) return { error: `점은 "x, y"로 적고 ;로 나눠요. (${p.trim()})` };
      const px = type === 'bar' ? parts[0].trim() : num(parts[0]);
      const py = num(parts[1]);
      if (px === '' || Number.isNaN(px) || Number.isNaN(py))
        return { error: `점의 값을 읽을 수 없어요. (${p.trim()})` };
      points.push({ x: px, y: py });
    }
    if (!points.length) return { error: `"${s.name || 'series'}"에 점이 없어요.` };
    if (points.length > 200) return { error: 'series 하나에 점은 200개까지 쓸 수 있어요.' };
    series.push({ name: s.name, points });
  }
  return { spec: { type, x, y, xRange, yRange, series } };
}

/** 사람이 읽기 좋은 눈금(1·2·5 × 10^n 간격). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // 1·2·5 간격 중 눈금 수가 count에 가장 가까운 것을 고른다(같으면 넓은 간격).
  const step = [10, 5, 2, 1]
    .map((k) => k * mag)
    .reduce((best, s) =>
      Math.abs((max - min) / s - count) < Math.abs((max - min) / best - count) ? s : best,
    );
  const start = Math.floor(min / step + 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  if (ticks[ticks.length - 1] < max)
    ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
  return ticks;
}
