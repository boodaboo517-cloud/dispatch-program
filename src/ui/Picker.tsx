import { useMemo, useState, type ReactNode } from 'react';
import { matchSearch } from '../domain/index.ts';

export interface PickItem {
  id: string;
  label: string;
  sub?: string;
  faded?: boolean;
  warn?: string;
  search?: string;
  right?: ReactNode;
}
export interface PickSection {
  label: string;
  items: PickItem[];
}

export function PickerList(p: {
  sections: PickSection[];
  onPick: (item: PickItem) => void;
  placeholder?: string;
  free?: { label: string; onFree: (text: string) => void };
  create?: { label: string; onCreate: (text: string) => void };
  top?: ReactNode;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    if (!q.trim()) return p.sections.filter((s) => s.items.length);
    const seen = new Set<string>();
    const items: PickItem[] = [];
    for (const s of p.sections) {
      for (const it of s.items) {
        if (seen.has(it.id)) continue;
        if (matchSearch(`${it.label} ${it.search ?? ''} ${it.sub ?? ''}`, q)) {
          seen.add(it.id);
          items.push(it);
        }
      }
    }
    return [{ label: `검색 결과 ${items.length}`, items }];
  }, [q, p.sections]);

  return (
    <div>
      <div className="search">
        <input autoFocus={false} value={q} onChange={(e) => setQ(e.target.value)} placeholder={p.placeholder ?? '검색 (초성 가능: ㄷㄷ)'} />
      </div>
      {p.top}
      {filtered.map((s) => (
        <div key={s.label}>
          <div className="section-label">{s.label}</div>
          {s.items.map((it) => (
            <div key={s.label + it.id} className={`list-item${it.faded ? ' faded' : ''}`} onClick={() => p.onPick(it)}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{it.label}</div>
                {it.sub && <div className="muted">{it.sub}</div>}
              </div>
              {it.warn && <span className="badge red">{it.warn}</span>}
              {it.right}
            </div>
          ))}
        </div>
      ))}
      {(p.free || p.create) && (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {p.free && <button onClick={() => p.free!.onFree(q)}>✏️ {p.free.label}{q ? `: "${q}"` : ''}</button>}
          {p.create && <button onClick={() => p.create!.onCreate(q)}>＋ {p.create.label}{q ? `: "${q}"` : ''}</button>}
        </div>
      )}
    </div>
  );
}

export function WeekdayChips(p: { value: number[]; onChange: (v: number[]) => void }) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const L = ['일', '월', '화', '수', '목', '금', '토'];
  return (
    <div className="weekdays">
      {order.map((d) => (
        <button
          key={d}
          type="button"
          className={p.value.includes(d) ? 'on' : ''}
          onClick={() => p.onChange(p.value.includes(d) ? p.value.filter((x) => x !== d) : [...p.value, d])}
        >
          {L[d]}
        </button>
      ))}
    </div>
  );
}

export function Seg<T extends string>(p: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`seg ${p.className ?? ''}`}>
      {p.options.map((o) => (
        <button key={o.value} type="button" className={p.value === o.value ? 'on' : ''} onClick={() => p.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
