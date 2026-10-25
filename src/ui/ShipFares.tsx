// 선박 요금 등록 (선박 수정 화면) · 배편 요금 구분·승선 (차량 칸에서)
import { useState } from 'react';
import {
  FARE_KIND_LABEL, buildBoard, removeShipFare, setShipFare, setVoyage, voyageOf, won,
  type BoardRow, type FareKind, type ShipFare, type VehicleType,
} from '../domain/index.ts';
import { store } from '../data/store.ts';
import { useSnap } from './hooks.ts';
import { Sheet } from './Sheet.tsx';

const TYPES: VehicleType[] = ['5톤', '통윙', '통윙2냉', '1톤', '승용'];
type Money = 'base' | 'empty' | 'surcharge' | 'boarding';
const COLS: [Money, string][] = [['base', '기본'], ['empty', '공차'], ['surcharge', '할증']];

const fmt = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('ko-KR'));
const parse = (t: string) => { const d = t.replace(/[^\d]/g, ''); return d ? Number(d) : null; };

function MoneyInput({ value, onSave, label }: { value: number | null | undefined; onSave: (v: number | null) => void; label: string }) {
  const [text, setText] = useState(fmt(value));
  return (
    <input inputMode="numeric" aria-label={label} placeholder="-" value={text} style={{ textAlign: 'right' }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { const v = parse(text); if (v !== (value ?? null)) onSave(v); setText(fmt(v)); }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
  );
}

/** 선박 수정 화면 안: 차종별 기본·공차·할증, 승선(기사 1인) */
export function ShipFaresCard({ shipId }: { shipId: string }) {
  const snap = useSnap();
  const rows = (snap.ship_fares ?? []).filter((f) => f.ship_id === shipId);
  const general = rows.find((f) => !f.vehicle_type);
  const typed = rows.filter((f) => f.vehicle_type).sort((a, b) => TYPES.indexOf(a.vehicle_type as VehicleType) - TYPES.indexOf(b.vehicle_type as VehicleType));
  const save = (type: string, k: Money, v: number | null) => store.run((tx) => {
    const cur = tx.list('ship_fares').find((f) => f.ship_id === shipId && f.vehicle_type === type);
    const base: Omit<ShipFare, 'id'> = { ship_id: shipId, vehicle_type: type, base: cur?.base ?? null, empty: cur?.empty ?? null, surcharge: cur?.surcharge ?? null, boarding: cur?.boarding ?? null };
    setShipFare(tx, { ...base, [k]: v });
  });
  const line = (type: string, f: ShipFare | undefined) => (
    <tr key={type || 'all'}>
      <td style={{ whiteSpace: 'nowrap' }}><b>{type || '모든 차종'}</b>
        {type && <button className="ghost" aria-label={`${type} 요금 삭제`} onClick={() => store.run((tx) => removeShipFare(tx, shipId, type))}>✕</button>}</td>
      {COLS.map(([k, l]) => <td key={k}><MoneyInput key={`${type}-${k}-${f?.[k] ?? ''}`} label={`${type || '모든 차종'} ${l}`} value={f?.[k]} onSave={(v) => save(type, k, v)} /></td>)}
    </tr>
  );
  return (
    <div className="card" style={{ background: '#f8fafc' }}>
      <b>🚢 선박 요금 (원)</b>
      <p className="muted small" style={{ margin: '4px 0 6px' }}>짐 실은 차는 기본, 빈 차는 공차로 자동 계산됩니다. 할증은 배편마다 차량 칸에서 고릅니다. 차종마다 요금이 다르면 차종 줄을 추가하세요.</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="simple small fare-table">
          <thead><tr><th>차종</th>{COLS.map(([k, l]) => <th key={k} className="num">{l}</th>)}</tr></thead>
          <tbody>
            {line('', general)}
            {typed.map((f) => line(f.vehicle_type, f))}
          </tbody>
        </table>
      </div>
      <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', marginTop: 6 }}>
        {TYPES.filter((t) => !typed.some((f) => f.vehicle_type === t)).map((t) => (
          <button key={t} className="chip" onClick={() => save(t, 'base', null)}>＋ {t} 요금</button>
        ))}
      </div>
      <label className="field" style={{ marginTop: 8 }}>
        <span>승선 (기사 1인 추가 금액)</span>
        <MoneyInput key={`boarding-${general?.boarding ?? ''}`} label="승선 금액" value={general?.boarding} onSave={(v) => save('', 'boarding', v)} />
      </label>
    </div>
  );
}

/** 차량 칸 → 선박 요금: 요금 구분(자동·기본·공차·할증) · 기사 승선 */
export function VoyageSheet({ date, row, close }: { date: string; row: BoardRow; close: () => void }) {
  const snap = useSnap();
  const cur = buildBoard(snap, date).rows.find((r) => r.vehicle.id === row.vehicle.id && r.secondary === row.secondary) ?? row;
  const [kind, setKind] = useState<FareKind>(cur.vd?.fare_kind ?? '');
  const [boarding, setBoarding] = useState(!!cur.vd?.boarding);
  const preview = voyageOf(snap, date, { ...cur, vd: { ...(cur.vd ?? ({} as NonNullable<BoardRow['vd']>)), fare_kind: kind, boarding } });
  const save = () => {
    store.run((tx) => setVoyage(tx, { date, vehicle_id: row.vehicle.id, zone: row.zone, fare_kind: kind, boarding }));
    close();
  };
  const auto = cur.loads.length + cur.carried.length > 0 ? '기본' : '공차';
  return (
    <Sheet title={`${row.vehicle.short_no} · ${preview.ship} 선박 요금`} onClose={close} footer={<button className="primary" onClick={save}>저장</button>}>
      <div className="field">
        <span>요금 구분</span>
        <div className="seg fp-seg" style={{ width: '100%' }}>
          {([['', `자동 (${auto})`], ['base', '기본'], ['empty', '공차'], ['surcharge', '할증']] as [FareKind, string][]).map(([k, l]) => (
            <button key={k || 'auto'} className={`grow ${kind === k ? 'on' : ''}`} style={{ flex: 1 }} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
      </div>
      <label className="row" style={{ gap: 8, alignItems: 'center', margin: '10px 0' }}>
        <input type="checkbox" checked={boarding} onChange={(e) => setBoarding(e.target.checked)} style={{ width: 22, height: 22 }} />
        <span style={{ fontSize: 17 }}>👤 기사 승선 (기사도 배를 탐)</span>
      </label>
      <div className="card" style={{ background: '#f8fafc' }}>
        <div>{FARE_KIND_LABEL[preview.kind]} {preview.fare == null ? <span className="muted">요금 미등록</span> : won(preview.fare)}</div>
        {boarding && <div>승선 {preview.boarding == null ? <span className="muted">금액 미등록</span> : won(preview.boarding)}</div>}
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>합계 {won(preview.total)}</div>
        {preview.missing.length > 0 && <div className="muted small">차량·설정 › 선박에서 {preview.missing.join(', ')}을 넣어 주세요.</div>}
      </div>
    </Sheet>
  );
}
