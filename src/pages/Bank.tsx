import { ManageCards } from '../components/ManageCards';
import { useState } from 'react';
import { Plus, Star, Flag, Pencil, Trash2, FileJson } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { emptyFilters, type Question, type QuestionBank, typeLabels } from '../domain/types';
import { filterQuestions } from '../domain/study';
import { parseBank, schemaVersionOf, toImportQuestion } from '../domain/import';
import { RichText, Statements } from '../components/RichText';
import { modelAnswers } from '../domain/grading';
import { QuestionFilters } from '../components/QuestionFilters';
import { SharedBanks } from '../components/SharedBanks';
import { QuestionTools } from '../components/QuestionTools';
import { Empty, Modal, subjectColor } from '../components/ui';
export function Bank({
  upload,
  initialSearch = '',
}: {
  upload: () => void;
  initialSearch?: string;
}) {
  const { data: d, perform, busy } = useApp();
  const [filters, setFilters] = useState({ ...emptyFilters, search: initialSearch }),
    [selected, setSelected] = useState<string[]>([]),
    [detail, setDetail] = useState<Question | null>(null),
    [edit, setEdit] = useState<Question | null>(null),
    [deleting, setDeleting] = useState<Question | null>(null),
    [limit, setLimit] = useState(30);
  if (!d) return null;
  const list = filterQuestions(d, filters).filter(
    (q) =>
      !selected.length || selected.includes(d.entries.find((e) => e.id === q.id)?.bankId || ''),
  );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR KNOWLEDGE LIBRARY</span>
          <h1>나의 문제은행</h1>
          <p>공부할 내용을 모으고, 나만의 지식을 쌓아 가세요.</p>
        </div>
        <button className="button primary" onClick={upload}>
          <Plus size={18} />
          문제 가져오기
        </button>
      </div>
      <SharedBanks />
      <QuestionTools upload={upload} />
      <ManageCards
        title="문제 세트"
        items={d.banks.map((b) => ({
          id: b.id,
          title: b.title,
          detail:
            b.subject +
            ' · ' +
            b.unit +
            ' · ' +
            d.entries.filter((e) => e.bankId === b.id && !e.archived).length +
            '문제',
        }))}
        selected={selected}
        onSelect={(ids) => {
          setSelected(ids);
          setLimit(30);
        }}
        remove={(r, id) => r.purgeContent(id)}
        action="세트 영구 삭제"
        warning="세트와 해당 문제의 풀이 기록을 영구 삭제합니다. 이미 보낸 사본은 유지됩니다."
      />
      <section className="panel bank-content">
        <QuestionFilters
          value={filters}
          onChange={(v) => {
            setFilters(v);
            setLimit(30);
          }}
          search
        />
        <div className="question-list-heading">
          <strong>
            {list.length}개의 문제{' '}
            {selected.length > 0 && (
              <button className="text-link" onClick={() => setSelected([])}>
                문제은행 선택 해제
              </button>
            )}
          </strong>
        </div>
        {list.length ? (
          <div className="question-list">
            {list.slice(0, limit).map((q) => {
              const entry = d.entries.find((e) => e.id === q.id)!;
              const p = d.progress.find((p) => p.questionId === q.id);
              return (
                <article className="question-row" key={q.id}>
                  <button className="question-row-main" onClick={() => setDetail(q)}>
                    <div className="question-row-meta">
                      <span className={`badge ${subjectColor(q.subject)}`}>{q.subject}</span>
                      <span>{typeLabels[q.type]}</span>
                      <span>{q.topic}</span>
                      {entry.report && <Flag size={13} className="text-orange" />}
                    </div>
                    <RichText as="h3" text={q.content} rich={q.rich} />
                    <div className="question-row-foot">
                      <span>
                        {q.sourceId} · v{q.version}
                      </span>
                      <span>
                        {p
                          ? `숙련도 ${p.mastery}% · ${p.totalAttempts}회 학습`
                          : '아직 만나지 않은 문제'}
                      </span>
                    </div>
                  </button>
                  <div className="row-actions">
                    <button
                      className={`icon-button ${entry.favorite ? 'favorited' : ''}`}
                      aria-label="즐겨찾기"
                      disabled={busy}
                      onClick={() =>
                        void perform((r) => r.updateQuestion(q.id, { favorite: !entry.favorite }))
                      }
                    >
                      <Star size={17} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="문제 수정"
                      onClick={() => setEdit(q)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="문제 삭제"
                      onClick={() => setDeleting(q)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty
            title="문제은행의 첫 장을 채워 보세요"
            description="JSON 파일을 가져오거나 검색 조건을 바꿔 보세요."
            action={
              <button className="button primary" onClick={upload}>
                <FileJson size={18} />
                문제 가져오기
              </button>
            }
          />
        )}
        {list.length > limit && (
          <button className="button secondary full" onClick={() => setLimit(limit + 30)}>
            문제 더 보기
          </button>
        )}
      </section>
      {detail && (
        <Modal title="문제 살펴보기" onClose={() => setDetail(null)}>
          <span className="badge green">
            {typeLabels[detail.type]} · {detail.topic}
          </span>
          <RichText as="h3" className="detail-question" text={detail.content} rich={detail.rich} />
          <Statements question={detail} />
          {detail.type === 'multiple_choice' &&
            detail.options.map((o) => (
              <p key={o.id}>
                {o.id}. <RichText text={o.text} rich={detail.rich} />
              </p>
            ))}
          <div className="notice">
            <strong>모범답안</strong>
            <RichText as="p" text={modelAnswers(detail).join(' · ')} rich={detail.rich} />
          </div>
          <RichText as="p" text={detail.explanation} rich={detail.rich} />
          <div className="question-tags">
            {detail.tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </div>
          <small className="muted">
            {detail.source} · {new Date(detail.createdAt).toLocaleDateString('ko-KR')} · 내부 버전{' '}
            {detail.version}
          </small>
          {d.entries.find((e) => e.id === detail.id)?.report && (
            <p className="notice">
              수정·삭제 예정 · 메모: {d.entries.find((e) => e.id === detail.id)?.report}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => {
                setDetail(null);
                setEdit(detail);
              }}
            >
              내용 수정
            </button>
            <button className="button primary" onClick={() => setDetail(null)}>
              확인
            </button>
          </div>
        </Modal>
      )}
      {edit && <EditQuestion question={edit} onClose={() => setEdit(null)} />}
      {deleting && (
        <Modal title="문제를 삭제할까요?" onClose={() => setDeleting(null)}>
          <p>문제와 해당 풀이 기록을 영구 삭제합니다. 세트의 마지막 문제라면 세트도 삭제됩니다.</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDeleting(null)}>
              취소
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void perform(
                  (r) =>
                    r.purgeContent(
                      d.entries.find((e) => e.id === deleting.id)!.bankId,
                      deleting.id,
                    ),
                  '문제를 삭제했어요.',
                ).then((ok) => {
                  if (ok) setDeleting(null);
                })
              }
            >
              삭제하기
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function EditQuestion({ question: q, onClose }: { question: Question; onClose: () => void }) {
  const { data: d, perform, busy } = useApp();
  const [text, setText] = useState(JSON.stringify(toImportQuestion(q), null, 2));
  const b = d!.banks.find((b) => b.id === d!.entries.find((e) => e.id === q.id)?.bankId)!;
  const version = schemaVersionOf([q]);
  const bank: QuestionBank = {
    schema_version: version,
    bank: { id: b.id, title: b.title, subject: b.subject, unit: b.unit },
    questions: [],
  };
  let parsed: ReturnType<typeof parseBank>;
  try {
    parsed = parseBank(JSON.stringify({ ...bank, questions: [JSON.parse(text)] }));
  } catch {
    parsed = { errors: ['올바른 JSON을 입력해 주세요.'] };
  }
  const changedId = parsed.bank?.questions[0].id !== q.sourceId;
  async function save() {
    if (!parsed.bank || changedId) return;
    if (
      await perform(
        (r) => r.importBank(parsed.bank!),
        '내용을 저장했어요. 이전 풀이 기록은 그대로 유지됩니다.',
      )
    )
      onClose();
  }
  return (
    <Modal title="문제 수정" onClose={onClose} wide>
      <p className="modal-intro">
        v{version} 문제 객체를 수정하세요. 내용이 달라지면 새 내부 버전이 만들어집니다.
      </p>
      <textarea
        className="code-input edit-code"
        aria-label="문제 수정 JSON"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      {parsed.errors.length > 0 && <p className="error-text">{parsed.errors[0]}</p>}
      {changedId && <p className="error-text">수정 시 문제 id는 유지해 주세요.</p>}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          취소
        </button>
        <button
          className="button primary"
          disabled={busy || parsed.errors.length > 0 || changedId}
          onClick={() => void save()}
        >
          수정 저장
        </button>
      </div>
    </Modal>
  );
}
