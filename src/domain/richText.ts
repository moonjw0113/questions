// v1.1 서식 텍스트 파서. HTML은 받지 않고, 수식·표·그래프·굵게·빈칸만 해석한다.
import { parseChart, type ChartResult } from './chart';
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'math'; tex: string }
  | { kind: 'bold'; children: Inline[] }
  | { kind: 'blank'; id: string };
export type Align = 'left' | 'center' | 'right' | null;
export type Block =
  | { kind: 'para'; lines: Inline[][] }
  | { kind: 'math'; tex: string }
  | { kind: 'table'; head: Inline[][]; align: Align[]; rows: Inline[][][] }
  | { kind: 'chart'; chart: ChartResult };
export interface RichOptions {
  /** {{1}} 같은 빈칸 표시를 빈칸으로 해석할지 */
  blanks?: boolean;
}

function pushText(out: Inline[], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.kind === 'text') last.text += text;
  else out.push({ kind: 'text', text });
}

/** 줄 안의 $수식$, **굵게**, {{빈칸}}, \$ 를 해석한다. 짝이 없는 기호는 글자 그대로 둔다. */
export function parseInline(text: string, options: RichOptions = {}): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && (text[i + 1] === '$' || text[i + 1] === '*')) {
      pushText(out, text[i + 1]);
      i += 2;
      continue;
    }
    if (c === '$') {
      const end = findClosingDollar(text, i + 1);
      if (end > i + 1) {
        out.push({ kind: 'math', tex: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (c === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        out.push({ kind: 'bold', children: parseInline(text.slice(i + 2, end), options) });
        i = end + 2;
        continue;
      }
    }
    if (options.blanks && c === '{' && text[i + 1] === '{') {
      const m = /^\{\{(\d+)\}\}/.exec(text.slice(i));
      if (m) {
        out.push({ kind: 'blank', id: m[1] });
        i += m[0].length;
        continue;
      }
    }
    pushText(out, c);
    i++;
  }
  return out;
}

function findClosingDollar(text: string, from: number) {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === '$') return j;
  }
  return -1;
}

const separator = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const isRow = (line: string) => line.trim().startsWith('|');

/** 표의 한 줄을 칸으로 나눈다. 수식 안의 | 와 \| 는 칸 구분으로 보지 않는다. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  const cells: string[] = [];
  let cell = '',
    math = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      cell += math ? '\\|' : '|';
      i++;
    } else if (c === '\\') {
      cell += c + (s[i + 1] ?? '');
      i++;
    } else if (c === '$') {
      math = !math;
      cell += c;
    } else if (c === '|' && !math) {
      cells.push(cell.trim());
      cell = '';
    } else cell += c;
  }
  if (cell.trim()) cells.push(cell.trim());
  return cells;
}

const alignOf = (cell: string): Align => {
  const t = cell.trim();
  if (t.startsWith(':') && t.endsWith(':')) return 'center';
  if (t.endsWith(':')) return 'right';
  if (t.startsWith(':')) return 'left';
  return null;
};

/** 글 속 그래프 블록의 형식 오류 목록. 가져오기 전에 알려 주려고 쓴다. */
export const chartErrors = (text: string) =>
  parseRich(text).flatMap((b) => (b.kind === 'chart' && b.chart.error ? [b.chart.error] : []));

export function parseRich(text: string, options: RichOptions = {}): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: Inline[][] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', lines: para });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '```chart') {
      const end = lines.findIndex((l, j) => j > i && l.trim() === '```');
      if (end > i) {
        flush();
        blocks.push({ kind: 'chart', chart: parseChart(lines.slice(i + 1, end).join('\n')) });
        i = end;
        continue;
      }
    }
    if (trimmed.startsWith('$$')) {
      const rest = trimmed.slice(2);
      const close = rest.indexOf('$$');
      let tex: string;
      if (close >= 0) {
        if (rest.slice(close + 2).trim()) {
          para.push(parseInline(line, options));
          continue;
        }
        tex = rest.slice(0, close);
      } else {
        const body = [rest];
        let j = i + 1;
        while (j < lines.length && !lines[j].includes('$$')) body.push(lines[j++]);
        if (j === lines.length) {
          para.push(parseInline(line, options));
          continue;
        }
        body.push(lines[j].slice(0, lines[j].indexOf('$$')));
        tex = body.join('\n');
        i = j;
      }
      flush();
      blocks.push({ kind: 'math', tex: tex.trim() });
      continue;
    }
    if (isRow(line) && i + 1 < lines.length && separator.test(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map(alignOf);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && isRow(lines[i]))
        rows.push(splitRow(lines[i++]).map((c) => parseInline(c, options)));
      i--;
      blocks.push({
        kind: 'table',
        head: head.map((c) => parseInline(c, options)),
        align: head.map((_, k) => align[k] ?? null),
        rows,
      });
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    para.push(parseInline(line, options));
  }
  flush();
  return blocks;
}
