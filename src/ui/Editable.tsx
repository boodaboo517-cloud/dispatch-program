// 간편수정: 항목을 누르면 그 자리에서 바로 고치고 자동 저장 (별도 저장 버튼 없음)
import { useEffect, useRef, useState } from 'react';
import { store } from '../data/store.ts';

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
  // 고치기 시작할 때의 값: 그 사이 다른 사용자가 같은 칸을 바꿨으면 덮어쓰지 않는다
  const startValue = useRef('');
  const begin = () => {
    startValue.current = String(p.value ?? '');
    setEditing(true);
  };
  const changedByOther = () => String(p.value ?? '') !== startValue.current;
  const commit = () => {
    if (v !== String(p.value ?? '') && changedByOther()) {
      store.toast(`다른 사용자가 먼저 "${p.label}"을(를) ${String(p.value ?? '') || '(빈 값)'}(으)로 수정했습니다 — 최신 값을 확인하고 다시 저장하세요`, 'warn');
      startValue.current = String(p.value ?? '');
      setV(String(p.value ?? ''));
      return;
    }
    setEditing(false);
    if (v !== String(p.value ?? '')) p.onSave?.(v);
  };
  // 입력 중에 시트가 닫혀도 쓰던 내용은 저장
  const latest = useRef({ editing, v, value: p.value, onSave: p.onSave });
  latest.current = { editing, v, value: p.value, onSave: p.onSave };
  useEffect(() => () => {
    const l = latest.current;
    if (l.editing && l.v !== String(l.value ?? '')) l.onSave?.(l.v);
  }, []);
  if (editing && p.onSave) {
    return (
      <div className="editable" style={{ borderColor: 'var(--blue)' }}>
        <span className="k">{p.label}</span>
        {p.options ? (
          <select ref={ref} value={v} onBlur={() => setEditing(false)} onChange={(e) => {
            // 고르는 즉시 저장 (휴대폰은 고른 뒤에도 선택칸에 포커스가 남아 있다)
            setV(e.target.value);
            if (e.target.value !== String(p.value ?? '') && changedByOther()) {
              store.toast(`다른 사용자가 먼저 "${p.label}"을(를) 수정했습니다 — 최신 값을 확인하고 다시 고르세요`, 'warn');
              startValue.current = String(p.value ?? '');
              setV(String(p.value ?? ''));
              return;
            }
            setEditing(false);
            if (e.target.value !== String(p.value ?? '')) p.onSave?.(e.target.value);
          }}>
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
    <div className="editable" onClick={() => p.onSave && begin()} style={{ cursor: p.onSave ? 'pointer' : 'default' }}>
      <span className="k">{p.label}</span>
      <span className={`v${shown ? '' : ' placeholder'}`}>{shown || p.placeholder || '-'}</span>
      {p.onSave && <span className="muted small">✎</span>}
    </div>
  );
}
