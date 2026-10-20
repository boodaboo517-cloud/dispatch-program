// 수량 입력: "10파렛트", "3대", "12p", "5 박스" 처럼 숫자 뒤에 단위를 써도 되고, 단위 버튼을 눌러도 된다
import { useEffect, useState } from 'react';
import type { Unit } from '../domain/index.ts';

export const UNIT_BUTTONS: Exclude<Unit, ''>[] = ['파렛트', '대', 'm', '박스'];

const UNIT_ALIASES: [RegExp, Exclude<Unit, ''>][] = [
  [/^(파렛트|파레트|파렛|팔레트|파|p|plt)$/i, '파렛트'],
  [/^(대)$/, '대'],
  [/^(m|미터|메터)$/i, 'm'],
  [/^(박스|box|bx|ㅂㅅ)$/i, '박스'],
];

/** "10파렛트" → { quantity: 10, unit: '파렛트' }. 숫자를 못 읽으면 null */
export function parseQty(text: string): { quantity: number | null; unit?: Exclude<Unit, ''> } | null {
  const m = /^\s*([0-9]+(?:[.,][0-9]+)?)?\s*([^\d\s.,]*)\s*$/.exec(text);
  if (!m) return null;
  const num = m[1] ? Number(m[1].replace(',', '.')) : null;
  const word = m[2];
  if (!word) return { quantity: num };
  const unit = UNIT_ALIASES.find(([re]) => re.test(word))?.[1];
  if (!unit) return null;
  return { quantity: num, unit };
}

export function QtyInput(p: { quantity: number | null; unit: Unit; onChange: (quantity: number | null, unit: Unit) => void; big?: boolean }) {
  const [text, setText] = useState(p.quantity == null ? '' : String(p.quantity));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    // 밖에서 값이 바뀌면(± 버튼, 품목 기본값) 입력칸도 맞춘다
    const cur = parseQty(text);
    if (!cur || cur.quantity !== p.quantity) setText(p.quantity == null ? '' : String(p.quantity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.quantity]);
  const type = (v: string) => {
    setText(v);
    const r = parseQty(v);
    setBad(!r);
    if (r) p.onChange(r.quantity, r.unit ?? p.unit);
  };
  const step = (d: number) => p.onChange(Math.max(0, (p.quantity ?? 0) + d), p.unit);
  const size = p.big ? { fontSize: 24, fontWeight: 800 } : {};
  return (
    <div>
      <div className="row">
        <button type="button" style={{ width: 52, ...size }} onClick={() => step(-1)} aria-label="하나 빼기">－</button>
        <input
          inputMode="text"
          value={text}
          placeholder="예: 10파렛트"
          onChange={(e) => type(e.target.value)}
          onBlur={() => !bad && setText(p.quantity == null ? '' : String(p.quantity))}
          style={{ textAlign: 'center', borderColor: bad ? 'var(--red)' : undefined, ...size }}
        />
        <button type="button" style={{ width: 52, ...size }} onClick={() => step(1)} aria-label="하나 더하기">＋</button>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        {UNIT_BUTTONS.map((u) => (
          <button key={u} type="button" className={`chip grow${p.unit === u ? ' on' : ''}`} style={{ minHeight: 44, justifyContent: 'center' }} onClick={() => p.onChange(p.quantity, p.unit === u ? '' : u)}>
            {u}
          </button>
        ))}
      </div>
      {bad && <div className="small" style={{ color: 'var(--red)' }}>숫자 뒤에는 파렛트·대·m·박스만 쓸 수 있습니다</div>}
    </div>
  );
}
