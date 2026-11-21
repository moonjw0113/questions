import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, ArrowRight, BookOpen } from 'lucide-react';

/**
 * 숫자를 직접 입력하는 칸. 입력 중에는 글자 그대로 두고, 칸을 벗어나거나 Enter를 누르면
 * min~max 범위의 정수로 맞춰 onCommit으로 알린다.
 */
export function NumberInput({
  value,
  min,
  max,
  onCommit,
  label,
  suffix,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  label: string;
  suffix?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    const next = Number.isFinite(n) && text.trim() ? Math.min(max, Math.max(min, n)) : value;
    setText(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <span className="number-input">
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
      {suffix && <span>{suffix}</span>}
    </span>
  );
}
export function Progress({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div
      className={`progress ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <BookOpen size={30} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowRight size={15} />
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="닫기" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export const subjectColor = (name: string) =>
  /생명|과학/.test(name)
    ? 'green'
    : /국어/.test(name)
      ? 'orange'
      : /한국|역사/.test(name)
        ? 'purple'
        : 'blue';
