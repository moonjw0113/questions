import { useMemo, useState } from 'react';
import { Combine, Copy, Download, FileUp, Flag, Trash2, Upload } from 'lucide-react';
import { useApp } from '../state/AppContext';
import {
  FLAG_DEFAULT,
  getQuestion,
  typeLabels,
  type AppData,
  type BankInfo,
  type Question,
  type QuestionBank,
} from '../domain/types';
import { parseBank, toBankFile } from '../domain/import';
import { mergeBanks } from '../domain/merge';
import { downloadJson } from '../domain/statistics';
import { Modal } from './ui';

function currentQuestions(d: AppData, ids?: Set<string>) {
  return d.entries
    .filter((e) => !ids || ids.has(e.id))
    .map((e) => getQuestion(d, { id: e.id, version: e.currentVersion }))
    .filter((q): q is Question => Boolean(q));
}
/** 선택한 문제를 세트(bank)별 가져오기 파일로 묶는다. */
function filesFor(d: AppData, ids: Set<string>) {
  const byBank = new Map<string, Question[]>();
  for (const q of currentQuestions(d, ids)) {
    const bankId = d.entries.find((e) => e.id === q.id)!.bankId;
    byBank.set(bankId, [...(byBank.get(bankId) || []), q]);
  }
  return [...byBank].map(([bankId, qs]) =>
    toBankFile(
      d.banks.find((b) => b.id === bankId)!,
      qs,
    ),
  );
}
const preview = (text: string) =>
  text
    .replace(/```chart[\s\S]*?```/g, '[그래프]')
    .replace(/\s+/g, ' ')
    .slice(0, 90);

export function QuestionTools({ upload }: { upload: () => void }) {
  const { data: d } = useApp();
  const [tab, setTab] = useState<'flagged' | 'merge'>('flagged');
  if (!d) return null;
  const flaggedCount = d.entries.filter((e) => e.report).length;
  return (
    <section className="panel question-tools">
      <div className="segmented small" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'flagged'}
          className={tab === 'flagged' ? 'active' : ''}
          onClick={() => setTab('flagged')}
        >
          <Flag size={14} />
          수정·삭제 예정 {flaggedCount}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'merge'}
          className={tab === 'merge' ? 'active' : ''}
          onClick={() => setTab('merge')}
        >
          <Combine size={14} />
          세트 합치기
        </button>
      </div>
      {tab === 'flagged' ? <FlaggedQuestions d={d} upload={upload} /> : <MergeSets d={d} />}
    </section>
  );
}

function FlaggedQuestions({ d, upload }: { d: AppData; upload: () => void }) {
  const { perform, busy, notify } = useApp();
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const flagged = currentQuestions(d, new Set(d.entries.filter((e) => e.report).map((e) => e.id)));
  const ids = new Set(selected.filter((id) => flagged.some((q) => q.id === id)));
  const memo = (q: Question) => d.entries.find((e) => e.id === q.id)?.report || '';
  const bankOf = (q: Question) =>
    d.banks.find((b) => b.id === d.entries.find((e) => e.id === q.id)?.bankId);
  if (!flagged.length)
    return (
      <p className="tools-empty">
        문제를 풀다가 깃발 버튼으로 <b>수정·삭제 예정</b> 표시를 하면 여기에 모여요. 모아서
        지우거나, JSON으로 내보내 AI로 고친 뒤 다시 가져올 수 있어요.
      </p>
    );
  const files = () => filesFor(d, ids);
  async function copy(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify(message);
    } catch {
      notify('복사하지 못했어요. 파일로 내보내 주세요.', true);
    }
  }
  const aiRequest = () => {
    const notes = flagged
      .filter((q) => ids.has(q.id) && memo(q) !== FLAG_DEFAULT)
      .map((q) => `- ${q.sourceId}: ${memo(q)}`);
    return `아래 차곡 문제를 검토해서 고쳐 줘.
- 각 문제의 bank.id와 문제 id는 그대로 둬야 차곡에서 같은 문제의 새 버전으로 들어가.
- 내 메모가 있으면 그 내용을 반영하고, 정답·해설이 문제와 맞는지도 확인해 줘. 고칠 게 없는 문제는 그대로 둬.
- schema_version 규격(question-bank 스키마)을 지키고, 추가 필드를 만들지 마.
- 결과는 세트마다 JSON 하나로 줘. 차곡 커넥터가 연결되어 있으면 import_question_bank로 바로 저장해도 돼.
${notes.length ? `\n내 메모:\n${notes.join('\n')}\n` : ''}
${files()
  .map((f) => JSON.stringify(f, null, 2))
  .join('\n\n')}`;
  };
  return (
    <>
      <div className="manage-tools tools-actions">
        <label>
          <input
            type="checkbox"
            checked={ids.size === flagged.length}
            onChange={(e) => setSelected(e.target.checked ? flagged.map((q) => q.id) : [])}
          />
          전체 선택 ({ids.size}/{flagged.length})
        </label>
        <div className="tools-buttons">
          <button
            className="button secondary"
            disabled={!ids.size}
            onClick={() => {
              const out = files();
              out.forEach((f) => downloadJson(f, `${f.bank.id}_수정용.json`));
              notify(`${out.length}개 세트 파일로 내보냈어요.`);
            }}
          >
            <Download size={15} />
            JSON 내보내기
          </button>
          <button
            className="button secondary"
            disabled={!ids.size}
            onClick={() => void copy(aiRequest(), 'AI 수정 요청과 문제 JSON을 복사했어요.')}
          >
            <Copy size={15} />
            AI 수정 요청 복사
          </button>
          <button className="button secondary" onClick={upload}>
            <Upload size={15} />
            고친 JSON 가져오기
          </button>
          <button
            className="text-link"
            disabled={!ids.size || busy}
            onClick={() =>
              void perform(async (r) => {
                for (const id of ids) await r.updateQuestion(id, { report: '' });
              }, `${ids.size}문제의 표시를 해제했어요.`).then((ok) => ok && setSelected([]))
            }
          >
            표시 해제
          </button>
          <button
            className="text-link danger"
            disabled={!ids.size || busy}
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={14} />
            선택 삭제
          </button>
        </div>
      </div>
      <p className="tools-hint">
        같은 세트 ID·문제 ID로 고친 JSON을 다시 가져오면 새 버전으로 바뀌고 풀이 기록은 그대로예요.
        다 고친 문제는 표시를 해제해 주세요.
      </p>
      <ul className="flagged-list">
        {flagged.map((q) => (
          <li key={q.id} className="manage-card">
            <label>
              <input
                type="checkbox"
                checked={ids.has(q.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...selected, q.id] : selected.filter((x) => x !== q.id),
                  )
                }
              />
              <span>
                <strong>{preview(q.content)}</strong>
                <small>
                  {bankOf(q)?.title} · {typeLabels[q.type]} · {q.sourceId} v{q.version}
                  {memo(q) !== FLAG_DEFAULT && <> · 메모: {memo(q)}</>}
                </small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {deleting && (
        <Modal title={`${ids.size}문제를 삭제할까요?`} onClose={() => setDeleting(false)}>
          <p className="notice">
            선택한 문제와 그 문제의 풀이 기록이 영구 삭제되고 통계와 복습 일정에서도 빠져요. 되돌릴
            수 없어요.
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDeleting(false)}>
              취소
            </button>
            <button
              className="button primary danger"
              disabled={busy}
              onClick={() =>
                void perform(async (r) => {
                  for (const id of ids)
                    await r.purgeContent(d.entries.find((e) => e.id === id)!.bankId, id);
                }, `${ids.size}문제를 삭제했어요.`).then((ok) => {
                  if (ok) setSelected([]);
                  setDeleting(false);
                })
              }
            >
              영구 삭제
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

type Source = { name: string; bank: QuestionBank };

function MergeSets({ d }: { d: AppData }) {
  const { perform, busy } = useApp();
  const [files, setFiles] = useState<(Source & { errors?: string[] })[]>([]);
  const [sets, setSets] = useState<string[]>([]);
  const [target, setTarget] = useState({ id: '', title: '', subject: '', unit: '' });
  const appSources: Source[] = useMemo(
    () =>
      d.banks
        .filter((b) => sets.includes(b.id))
        .map((b: BankInfo) => {
          const qs = currentQuestions(d).filter(
            (q) => d.entries.find((e) => e.id === q.id)?.bankId === b.id,
          );
          return { name: b.title, bank: toBankFile(b, qs) };
        }),
    [d, sets],
  );
  const sources = [...appSources, ...files.filter((f) => !f.errors)];
  const first = sources[0]?.bank.bank;
  const t = {
    id: target.id || (first ? `${first.id}-merged` : ''),
    title: target.title || (first ? `${first.title} (합본)` : ''),
    subject: target.subject || first?.subject || '',
    unit: target.unit || first?.unit || '',
  };
  const merged = sources.length >= 2 ? mergeBanks(sources, t) : null;
  const check = merged ? parseBank(JSON.stringify(merged.bank)) : null;
  const exists = d.banks.find((b) => b.id === t.id);
  async function readFiles(list: FileList) {
    const next = await Promise.all(
      [...list].map(async (file) => {
        const parsed = parseBank(await file.text());
        return parsed.bank
          ? { name: file.name, bank: parsed.bank }
          : { name: file.name, bank: null as unknown as QuestionBank, errors: parsed.errors };
      }),
    );
    setFiles([...files, ...next]);
  }
  return (
    <div className="merge-sets">
      <p className="tools-hint">
        합칠 세트를 2개 이상 고르세요. 앱에 있는 세트와 JSON 파일을 섞어서 합칠 수 있어요. 원래
        세트는 그대로 남아요.
      </p>
      {d.banks.length > 0 && (
        <div className="merge-sources">
          {d.banks.map((b) => (
            <label key={b.id} className="check-row">
              <input
                type="checkbox"
                checked={sets.includes(b.id)}
                onChange={(e) =>
                  setSets(e.target.checked ? [...sets, b.id] : sets.filter((x) => x !== b.id))
                }
              />
              {b.title}
              <small>
                {b.subject} · {b.unit} · {d.entries.filter((e) => e.bankId === b.id).length}문제
              </small>
            </label>
          ))}
        </div>
      )}
      <label className="button secondary merge-file">
        <FileUp size={15} />
        JSON 파일 추가
        <input
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void readFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {files.length > 0 && (
        <ul className="merge-files">
          {files.map((f, i) => (
            <li key={i} className={f.errors ? 'has-error' : ''}>
              <span>
                {f.name}
                {f.errors
                  ? ` · 형식 오류: ${f.errors[0]}`
                  : ` · ${f.bank.questions.length}문제 · v${f.bank.schema_version}`}
              </span>
              <button
                className="text-link"
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
              >
                빼기
              </button>
            </li>
          ))}
        </ul>
      )}
      {merged && (
        <>
          <div className="merge-target">
            {(
              [
                ['id', '새 세트 ID'],
                ['title', '제목'],
                ['subject', '과목'],
                ['unit', '단원'],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                {label}
                <input value={t[k]} onChange={(e) => setTarget({ ...t, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <p className="notice">
            {sources.length}개 세트 · {merged.bank.questions.length}문제 · v
            {merged.bank.schema_version}
            {merged.renamed.length > 0 &&
              ` · 겹치는 문제 ID ${merged.renamed.length}개는 ${merged.renamed
                .slice(0, 3)
                .map((r) => `${r.from}→${r.to}`)
                .join(', ')}${merged.renamed.length > 3 ? ' …' : ''}로 바꿨어요`}
            {exists &&
              ` · 이미 있는 세트 ID예요. 가져오면 그 세트에 문제가 더해지고 같은 ID 문제는 새 버전이 돼요`}
          </p>
          {check?.errors.length ? (
            <p className="notice error">{check.errors.slice(0, 3).join(' / ')}</p>
          ) : (
            <div className="tools-buttons">
              <button
                className="button secondary"
                onClick={() => downloadJson(merged.bank, `${t.id}.json`)}
              >
                <Download size={15} />
                합친 JSON 다운로드
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void perform(
                    (r) => r.importBank(merged.bank),
                    `"${t.title}" 세트로 ${merged.bank.questions.length}문제를 합쳤어요.`,
                  ).then((ok) => {
                    if (ok) {
                      setFiles([]);
                      setSets([]);
                      setTarget({ id: '', title: '', subject: '', unit: '' });
                    }
                  })
                }
              >
                <Combine size={15} />
                차곡에 새 세트로 가져오기
              </button>
            </div>
          )}
        </>
      )}
      {!merged && sources.length === 1 && (
        <p className="tools-hint">세트를 하나 더 고르면 합칠 수 있어요.</p>
      )}
    </div>
  );
}
