import { useState } from 'react';
import { Download, Copy, FileJson } from 'lucide-react';
import { analysisPrompt } from 'virtual:study-content';
import { analysisExport, dayKey, downloadJson, type ExportScope } from '../domain/statistics';
import { useApp } from '../state/AppContext';
import { Modal } from './ui';
export function ExportModal({ onClose }: { onClose: () => void }) {
  const { data: d, notify } = useApp();
  const [scope, setScope] = useState<ExportScope>({ period: 'all', subject: '', unit: '' }),
    [showPrompt, setShowPrompt] = useState(false);
  const result = analysisExport(d!, scope);
  async function copy() {
    try {
      await navigator.clipboard.writeText(analysisPrompt);
      notify('GPT 분석 요청 프롬프트를 복사했어요.');
    } catch {
      setShowPrompt(true);
      notify('아래 프롬프트를 직접 선택해서 복사해 주세요.');
    }
  }
  return (
    <Modal title="학습 결과 내보내기" onClose={onClose}>
      <div className="export-illustration">
        <FileJson size={35} />
      </div>
      <p className="modal-intro">
        학습 기록을 ChatGPT Work에 전달하고, 나에게 필요한 새 문제를 받아 보세요.
      </p>
      <div className="export-filters">
        <label>
          기록 범위
          <select
            value={scope.period}
            onChange={(e) =>
              setScope({ ...scope, period: e.target.value as ExportScope['period'] })
            }
          >
            <option value="all">전체 학습 기록</option>
            <option value="7">최근 7일</option>
            <option value="30">최근 30일</option>
            <option value="wrong">틀린 문제 중심</option>
          </select>
        </label>
        <label>
          과목
          <select
            value={scope.subject}
            onChange={(e) => setScope({ ...scope, subject: e.target.value, unit: '' })}
          >
            <option value="">전체 과목</option>
            {d!.subjects.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        <label>
          단원
          <select value={scope.unit} onChange={(e) => setScope({ ...scope, unit: e.target.value })}>
            <option value="">전체 단원</option>
            {[
              ...new Set(
                d!.subjects
                  .filter((s) => !scope.subject || s.name === scope.subject)
                  .flatMap((s) => s.units),
              ),
            ].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="notice">
        풀이 {result.summary.attempts}회 · 정답률 {result.summary.accuracy}%<br />
        과목·단원·유형 통계, 취약 개념, 대표 오답과 문항 숙련도를 포함해요. 이메일과 사용자 ID는
        포함하지 않아요.
      </div>
      <div className="export-actions">
        <button
          className="button primary full"
          onClick={() => {
            downloadJson(result, `study_result_${dayKey()}.json`);
            notify('학습 결과 파일을 다운로드했어요.');
          }}
        >
          <Download size={18} />
          study_result JSON 다운로드
        </button>
        <button className="button secondary full" onClick={() => void copy()}>
          <Copy size={17} />
          GPT 분석 요청용 프롬프트 복사
        </button>
        <a
          className="text-link"
          href={`${import.meta.env.BASE_URL}question-bank.schema.json`}
          download
        >
          함께 첨부할 문제 JSON 스키마 받기
        </a>
      </div>
      {showPrompt && (
        <textarea
          className="code-input"
          aria-label="분석 요청 프롬프트"
          readOnly
          value={analysisPrompt}
          onFocus={(e) => e.target.select()}
        />
      )}
    </Modal>
  );
}
