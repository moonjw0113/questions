import { createElement, Fragment, useEffect, useState, type ReactNode } from 'react';
import type Katex from 'katex';
import { parseRich, type Inline } from '../domain/richText';
import { statementLabel } from '../domain/import';
import type { Question } from '../domain/types';

// KaTeX(약 300KB)는 수식이 있는 문제를 처음 볼 때만 불러온다.
let katex: typeof Katex | null = null;
let loading: Promise<typeof Katex> | null = null;
const loadKatex = () =>
  (loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
    async ([m]) => {
      await import('katex/contrib/mhchem');
      return (katex = m.default);
    },
  ));

function useKatex(needed: boolean) {
  const [lib, setLib] = useState(katex);
  useEffect(() => {
    if (needed && !lib) void loadKatex().then((k) => setLib(() => k));
  }, [needed, lib]);
  return lib;
}

function TexMath({
  tex,
  display,
  lib,
}: {
  tex: string;
  display?: boolean;
  lib: typeof Katex | null;
}) {
  if (!lib) return <code className="rich-math-pending">{tex}</code>;
  const html = lib.renderToString(tex, {
    displayMode: !!display,
    throwOnError: false,
    strict: 'ignore',
    trust: false,
    output: 'htmlAndMathml',
  });
  return (
    <span
      className={display ? 'rich-math-block' : 'rich-math'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

type Tag = 'p' | 'span' | 'h1' | 'h3' | 'strong' | 'div';

/**
 * 문제 글을 표시한다. rich(v1.1)일 때만 수식·표·굵게를 해석하고,
 * v1.0 문제는 지금까지처럼 글자 그대로 보여 준다.
 */
export function RichText({
  text,
  rich,
  blank,
  as = 'span',
  className,
}: {
  text: string;
  rich?: boolean;
  blank?: (id: string) => ReactNode;
  as?: Tag;
  className?: string;
}) {
  const lib = useKatex(!!rich && text.includes('$'));
  if (!rich) {
    const content = blank
      ? text
          .split(/(\{\{\d+\}\})/g)
          .map((p, i) => (
            <Fragment key={i}>{p.startsWith('{{') ? blank(p.replace(/[{}]/g, '')) : p}</Fragment>
          ))
      : text;
    return createElement(as, { className }, content);
  }
  const inline = (xs: Inline[]): ReactNode[] =>
    xs.map((x, i) =>
      x.kind === 'text' ? (
        <Fragment key={i}>{x.text}</Fragment>
      ) : x.kind === 'math' ? (
        <TexMath key={i} tex={x.tex} lib={lib} />
      ) : x.kind === 'bold' ? (
        <b key={i}>{inline(x.children)}</b>
      ) : (
        <Fragment key={i}>{blank ? blank(x.id) : `{{${x.id}}}`}</Fragment>
      ),
    );
  const blocks = parseRich(text, { blanks: !!blank }).map((b, i) =>
    b.kind === 'para' ? (
      <span className="rich-para" key={i}>
        {b.lines.map((line, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(line)}
          </Fragment>
        ))}
      </span>
    ) : b.kind === 'math' ? (
      <TexMath key={i} tex={b.tex} display lib={lib} />
    ) : (
      <span className="rich-table" key={i}>
        <table>
          <thead>
            <tr>
              {b.head.map((c, k) => (
                <th key={k} style={b.align[k] ? { textAlign: b.align[k]! } : undefined}>
                  {inline(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((row, r) => (
              <tr key={r}>
                {b.head.map((_, k) => (
                  <td key={k} style={b.align[k] ? { textAlign: b.align[k]! } : undefined}>
                    {inline(row[k] || [])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </span>
    ),
  );
  // 표는 <p> 안에 둘 수 없어서 서식 문단은 div로 감싼다.
  return createElement(
    as === 'p' ? 'div' : as,
    { className: ['rich', as === 'p' && 'rich-p', className].filter(Boolean).join(' ') },
    blocks,
  );
}

/** 〈보기〉 진술 상자. 진술이 없으면 아무것도 그리지 않는다. */
export function Statements({ question: q }: { question: Question }) {
  if (!q.statements?.length) return null;
  return (
    <div className="statements" role="group" aria-label="보기">
      <span className="statements-title">보기</span>
      <ol>
        {q.statements.map((t, i) => (
          <li key={i}>
            <span className="statement-label">{statementLabel(i)}.</span>
            <RichText text={t} rich={q.rich} />
          </li>
        ))}
      </ol>
    </div>
  );
}
