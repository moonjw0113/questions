import { useMemo, useState } from 'react';
import { Upload, FileJson, CheckCircle2, AlertCircle, Clipboard, Download } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { inspectImport, parseBank } from '../domain/import';
import { typeLabels } from '../domain/types';
import { Modal } from './ui';
export function ImportModal({ onClose }: { onClose: () => void }) {
  const { data, perform, busy, notify } = useApp(),
    [text, setText] = useState(''),
    [tab, setTab] = useState<'file' | 'text'>('file'),
    [filename, setFilename] = useState(''),
    [drag, setDrag] = useState(false),
    [readError, setReadError] = useState('');
  const parsed = useMemo(() => (text ? parseBank(text) : { errors: [] }), [text]);
  const preview = parsed.bank && data ? inspectImport(parsed.bank, data) : null;
  const errors = [...parsed.errors, ...(preview?.errors || []), ...(readError ? [readError] : [])];
  async function read(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setReadError('파일은 10MB 이하만 업로드할 수 있습니다.');
      return;
    }
    try {
      setReadError('');
      setFilename(file.name);
      setText(await file.text());
    } catch {
      setReadError('파일을 읽지 못했습니다. 다시 선택해 주세요.');
    }
  }
  async function save() {
    if (!parsed.bank || errors.length) return;
    const ok = await perform(async (r) => {
      const result = await r.importBank(parsed.bank!);
      notify(
        `새 문제 ${result.added}개 · 새 버전 ${result.updated}개 · 중복 제외 ${result.skipped}개`,
      );
    });
    if (ok) onClose();
  }
  return (
    <Modal title="문제 가져오기" onClose={onClose} wide>
      <p className="modal-intro">ChatGPT Work에서 만든 문제를 나의 문제은행에 추가해요.</p>
      <div className="segmented">
        <button className={tab === 'file' ? 'active' : ''} onClick={() => setTab('file')}>
          <FileJson size={17} />
          JSON 파일
        </button>
        <button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')}>
          <Clipboard size={17} />
          텍스트 붙여넣기
        </button>
      </div>
      {tab === 'file' ? (
        <label
          className={`dropzone ${drag ? 'dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void read(e.dataTransfer.files[0]);
          }}
        >
          <span className="upload-icon">
            <Upload size={28} />
          </span>
          <strong>{filename || '파일을 선택하거나 이곳에 놓아 주세요'}</strong>
          <span>JSON 파일 · 최대 10MB · 최대 2,000문제</span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => void read(e.target.files?.[0])}
          />
          <span className="button secondary">파일 선택</span>
        </label>
      ) : (
        <textarea
          className="code-input"
          aria-label="문제 JSON 붙여넣기"
          placeholder={
            '{\n  "schema_version": "1.0",\n  "bank": { ... },\n  "questions": [ ... ]\n}'
          }
          value={text}
          onChange={(e) => {
            setReadError('');
            setText(e.target.value);
          }}
          spellCheck={false}
        />
      )}
      <div className="import-help">
        <span>고정 규격 v1.0</span>
        <a href={`${import.meta.env.BASE_URL}examples/biology.json`} download>
          <Download size={13} />
          예제 파일
        </a>
        <a href={`${import.meta.env.BASE_URL}question-bank.schema.json`} download>
          JSON 스키마
        </a>
      </div>
      {errors.length > 0 && (
        <div className="error-box" role="alert">
          <strong>
            <AlertCircle size={17} />
            파일을 확인해 주세요
          </strong>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {parsed.bank && preview && !errors.length && (
        <div className="import-preview">
          <div className="preview-title">
            <CheckCircle2 size={20} />
            <div>
              <strong>{parsed.bank.bank.title}</strong>
              <small>
                {parsed.bank.bank.subject} · {parsed.bank.bank.unit}
              </small>
            </div>
            <span className="badge green">검증 완료</span>
          </div>
          <div className="import-counts">
            {Object.entries(typeLabels).map(([type, label]) => (
              <div key={type}>
                <strong>{parsed.bank!.questions.filter((q) => q.type === type).length}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p className="notice">
            새 문제 {preview.added}개 · 내용 변경 {preview.updated}개 · 중복 {preview.skipped}개
            <br />
            기존 풀이 기록은 유지됩니다. 같은 ID의 변경 내용은 새 내부 버전으로 저장돼요.
          </p>
          <details>
            <summary>문제 미리보기 ({parsed.bank.questions.length}개)</summary>
            <div className="preview-list">
              {parsed.bank.questions.map((q, i) => (
                <div key={q.id}>
                  <small>
                    {i + 1}. {typeLabels[q.type]} · {q.topic}
                  </small>
                  <p>{q.prompt}</p>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          닫기
        </button>
        <button
          className="button primary"
          disabled={busy || !parsed.bank || errors.length > 0}
          onClick={() => void save()}
        >
          {busy ? '저장 중…' : `문제 ${parsed.bank?.questions.length || 0}개 가져오기`}
        </button>
      </div>
    </Modal>
  );
}
