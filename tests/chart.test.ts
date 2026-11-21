import { describe, it, expect } from 'vitest';
import { niceTicks, parseChart } from '../src/domain/chart';
import { parseRich } from '../src/domain/richText';
import { parseBank } from '../src/domain/import';
import { readFileSync } from 'node:fs';

describe('그래프 블록', () => {
  it('꺾은선 그래프의 축·범위·여러 계열을 읽는다', () => {
    expect(
      parseChart(
        'type: 꺾은선\nx: 시간 (s)\ny: 속력 (m/s)\nxrange: 0 10\nyrange: 0 8\nseries A: 0, 0; 2, 4.5; 4, 4\nseries B: 0, 2; 4, -1.5e0',
      ),
    ).toEqual({
      spec: {
        type: 'line',
        x: '시간 (s)',
        y: '속력 (m/s)',
        xRange: [0, 10],
        yRange: [0, 8],
        series: [
          {
            name: 'A',
            points: [
              { x: 0, y: 0 },
              { x: 2, y: 4.5 },
              { x: 4, y: 4 },
            ],
          },
          {
            name: 'B',
            points: [
              { x: 0, y: 2 },
              { x: 4, y: -1.5 },
            ],
          },
        ],
      },
    });
  });
  it('막대 그래프는 x를 항목 이름으로 읽고, 이름 없는 계열도 허용한다', () => {
    expect(parseChart('type: bar\nseries: (가), 30; (나), 45').spec?.series).toEqual([
      {
        name: '',
        points: [
          { x: '(가)', y: 30 },
          { x: '(나)', y: 45 },
        ],
      },
    ]);
  });
  it.each([
    ['x: a\nseries: 1, 2', 'type 항목이 필요'],
    ['type: pie\nseries: 1, 2', 'type은'],
    ['type: line', 'series 항목이 하나 이상'],
    ['type: line\nseries: 1 2', '"x, y"'],
    ['type: line\nseries: 가, 2', '읽을 수 없어요'],
    ['type: line\nyrange: 5 1\nseries: 1, 2', 'yrange'],
    ['type: line\ncolor: red\nseries: 1, 2', '알 수 없는 항목'],
    ['type: line\n이상한 줄\nseries: 1, 2', '항목: 값'],
  ])('형식 오류를 알려 준다: %s', (body, message) => {
    expect(parseChart(body).error).toContain(message);
  });
  it('보기 좋은 눈금을 만든다', () => {
    expect(niceTicks(0, 28)).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(niceTicks(18, 30)).toEqual([18, 20, 22, 24, 26, 28, 30]);
    expect(niceTicks(0, 0.7)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(niceTicks(5, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });
  it('서식 글 속 블록을 그래프로 나누고, 닫히지 않은 블록은 글로 둔다', () => {
    expect(
      parseRich('위\n```chart\ntype: scatter\nseries: 1, 2\n```\n아래').map((b) => b.kind),
    ).toEqual(['para', 'chart', 'para']);
    expect(parseRich('```chart\ntype: line').map((b) => b.kind)).toEqual(['para']);
  });
  it('v1.1 가져오기에서 그래프 형식 오류를 막고, v1.0은 글로 둔다', () => {
    const bank = JSON.parse(readFileSync('public/examples/science-v1_1.json', 'utf8'));
    expect(parseBank(JSON.stringify(bank)).errors).toEqual([]);
    bank.questions[3].prompt = '```chart\ntype: pie\nseries: 1, 2\n```';
    expect(parseBank(JSON.stringify(bank)).errors).toEqual([
      '문제 4 (sci-004): 그래프 형식 오류 · type은 line, scatter, bar 중 하나예요. (pie)',
    ]);
    bank.schema_version = '1.0';
    for (const q of bank.questions) delete q.statements;
    expect(parseBank(JSON.stringify(bank)).errors).toEqual([]);
  });
});
