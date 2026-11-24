// 여러 문제은행(JSON 파일·앱의 세트)을 하나의 세트로 합친다.
import type { QuestionBank, SchemaVersion } from './types';

export interface MergeTarget {
  id: string;
  title: string;
  subject: string;
  unit: string;
}
export interface MergeResult {
  bank: QuestionBank;
  /** 다른 세트와 ID가 겹쳐 이름을 바꾼 문제 */
  renamed: { source: string; from: string; to: string }[];
}

/**
 * 문제를 차례로 이어 붙인다. 같은 문제 ID가 이미 있으면 -2, -3…을 붙여 겹치지 않게 한다.
 * 하나라도 v1.1이면 v1.1로 만든다(v1.0 문제도 v1.1에서 그대로 유효하다).
 */
export function mergeBanks(
  sources: { name: string; bank: QuestionBank }[],
  target: MergeTarget,
): MergeResult {
  const used = new Set<string>();
  const renamed: MergeResult['renamed'] = [];
  const questions = sources.flatMap(({ name, bank }) =>
    bank.questions.map((q) => {
      let id = q.id;
      for (let n = 2; used.has(id); n++) id = `${q.id}-${n}`.slice(-100);
      used.add(id);
      if (id !== q.id) renamed.push({ source: name, from: q.id, to: id });
      return { ...structuredClone(q), id };
    }),
  );
  const version: SchemaVersion = sources.some((s) => s.bank.schema_version === '1.1')
    ? '1.1'
    : '1.0';
  return {
    bank: { schema_version: version, bank: { ...target }, questions },
    renamed,
  };
}
