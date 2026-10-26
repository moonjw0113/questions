import { useState } from 'react';
import {
  Plus,
  FolderOpen,
  Star,
  Flag,
  Pencil,
  Trash2,
  ArchiveRestore,
  FileJson,
  ArrowUpRight,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { emptyFilters, type Question, type QuestionBank, typeLabels } from '../domain/types';
import { filterQuestions } from '../domain/study';
import { parseBank, toImportQuestion } from '../domain/import';
import { modelAnswers } from '../domain/grading';
import { QuestionFilters } from '../components/QuestionFilters';
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
    [bankId, setBankId] = useState(''),
    [detail, setDetail] = useState<Question | null>(null),
    [edit, setEdit] = useState<Question | null>(null),
    [deleting, setDeleting] = useState<Question | null>(null),
    [showArchived, setShowArchived] = useState(false),
    [limit, setLimit] = useState(30);
  if (!d) return null;
  const list = filterQuestions(d, filters).filter(
    (q) => !bankId || d.entries.find((e) => e.id === q.id)?.bankId === bankId,
  );
  const archived = d.entries.filter((e) => e.archived);
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
      <div className="bank-summary-grid">
        {d.banks.map((b) => (
          <button
            key={b.id}
            className={`bank-card panel ${bankId === b.id ? 'selected' : ''}`}
            onClick={() => {
              setBankId(bankId === b.id ? '' : b.id);
              setLimit(30);
            }}
          >
            <span className={`subject-icon ${subjectColor(b.subject)}`}>
              <FolderOpen size={23} />
            </span>
            <div>
              <small>
                {b.subject} · {b.unit}
              </small>
              <h3>{b.title}</h3>
              <p>{d.entries.filter((e) => e.bankId === b.id && !e.archived).length}문제</p>
            </div>
            <ArrowUpRight size={17} />
          </button>
        ))}
      </div>
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
            {bankId && (
              <button className="text-link" onClick={() => setBankId('')}>
                문제은행 선택 해제
              </button>
            )}
          </strong>
          <button className="text-link" onClick={() => setShowArchived(!showArchived)}>
            삭제한 문제 ({archived.length})
          </button>
        </div>
        {showArchived && (
          <div className="archived-list">
            {archived.length ? (
              archived.map((e) => (
                <div key={e.id}>
                  <span>
                    {
                      d.versions.find(
                        (v) => v.question.id === e.id && v.question.version === e.currentVersion,
                      )?.question.content
                    }
                  </span>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        (r) => r.updateQuestion(e.id, { archived: false }),
                        '문제를 복구했어요.',
                      )
                    }
                  >
                    <ArchiveRestore size={16} />
                    복구
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">삭제한 문제가 없어요.</p>
            )}
          </div>
        )}
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
                    <h3>{q.content}</h3>
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
          <h3 className="detail-question">{detail.content}</h3>
          {detail.type === 'multiple_choice' &&
            detail.options.map((o) => (
              <p key={o.id}>
                {o.id}. {o.text}
              </p>
            ))}
          <div className="notice">
            <strong>모범답안</strong>
            <p>{modelAnswers(detail).join(' · ')}</p>
          </div>
          <p>{detail.explanation}</p>
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
            <p className="notice">오류 메모: {d.entries.find((e) => e.id === detail.id)?.report}</p>
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
          <p>
            학습 목록에서 제외됩니다. 이전 풀이 기록과 통계는 유지되고, 삭제한 문제에서 복구할 수
            있어요.
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDeleting(null)}>
              취소
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void perform(
                  (r) => r.updateQuestion(deleting.id, { archived: true }),
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
  const bank: QuestionBank = {
    schema_version: '1.0',
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
        v1.0 문제 객체를 수정하세요. 내용이 달라지면 새 내부 버전이 만들어집니다.
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
