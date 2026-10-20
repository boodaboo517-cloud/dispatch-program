// 간편수정: 항목을 누르면 그 자리에서 바로 고치고 자동 저장 (별도 저장 버튼 없음)
import { useEffect, useRef, useState } from 'react';

export function Editable(p: {
  label: string;
  value: string | number | null;
  placeholder?: string;
  onSave?: (v: string) => void;
  multiline?: boolean;
  type?: 'text' | 'number' | 'tel';
  options?: { value: string; label: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(String(p.value ?? ''));
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);
  useEffect(() => {
    if (!editing) setV(String(p.value ?? ''));
  }, [p.value, editing]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  const commit = () => {
    setEditing(false);
    if (v !== String(p.value ?? '')) p.onSave?.(v);
  };
  if (editing && p.onSave) {
    return (
      <div className="editable" style={{ borderColor: 'var(--blue)' }}>
        <span className="k">{p.label}</span>
        {p.options ? (
          <select ref={ref} value={v} onChange={(e) => { setV(e.target.value); }} onBlur={commit}>
            {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : p.multiline ? (
          <textarea ref={ref} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} />
        ) : (
          <input ref={ref} type={p.type === 'number' ? 'text' : p.type ?? 'text'} inputMode={p.type === 'number' ? 'decimal' : undefined} value={v}
            onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        )}
      </div>
    );
  }
  const shown = p.options ? p.options.find((o) => o.value === String(p.value ?? ''))?.label : p.value;
  return (
    <div className="editable" onClick={() => p.onSave && setEditing(true)} style={{ cursor: p.onSave ? 'pointer' : 'default' }}>
      <span className="k">{p.label}</span>
      <span className={`v${shown ? '' : ' placeholder'}`}>{shown || p.placeholder || '-'}</span>
      {p.onSave && <span className="muted small">✎</span>}
    </div>
  );
}
