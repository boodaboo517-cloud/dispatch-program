// 매출 › 선박비: 기간 동안 배를 탄 차량마다 선박 요금(기본·공차·할증) + 기사 승선 금액
import { useMemo, useState } from 'react';
import { FARE_KIND_LABEL, bulkCosts, shipCosts, won, type Voyage } from '../domain/index.ts';
import { useNavigate } from 'react-router-dom';
import { clientName, productName, qtyText } from '../ui/labels.ts';
import { fmtDate } from '../lib/time.ts';
import { useSnap } from '../ui/hooks.ts';
import { useSheet } from '../ui/Sheet.tsx';
import { VoyageSheet } from '../ui/ShipFares.tsx';

export function ShipCostPanel({ from, to }: { from: string; to: string }) {
  const snap = useSnap();
  const sheet = useSheet();
  const [showAll, setShowAll] = useState(false);
  const nav = useNavigate();
  const voyages = useMemo(() => shipCosts(snap, from, to), [snap, from, to]);
  const bulks = useMemo(() => bulkCosts(snap, from, to), [snap, from, to]);
  const bulkTotal = bulks.reduce((a, b) => a + (b.fee ?? 0), 0);
  const bulkMissing = bulks.filter((b) => b.missing).length;
  const byShip = useMemo(() => {
    const m = new Map<string, { n: number; base: number; empty: number; surcharge: number; boardingN: number; boarding: number; total: number; missing: number }>();
    for (const v of voyages) {
      const k = v.ship || '(선박명 없음)';
      const s = m.get(k) ?? { n: 0, base: 0, empty: 0, surcharge: 0, boardingN: 0, boarding: 0, total: 0, missing: 0 };
      s.n++;
      s[v.kind]++;
      if (v.row.vd?.boarding) { s.boardingN++; s.boarding += v.boarding ?? 0; }
      s.total += v.total;
      if (v.missing.length) s.missing++;
      m.set(k, s);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [voyages]);
  const total = voyages.reduce((a, v) => a + v.total, 0);
  const missing = voyages.filter((v) => v.missing.length);
  const list = showAll ? voyages : voyages.slice(0, 50);
  const open = (v: Voyage) => sheet.open((close) => <VoyageSheet date={v.date} row={v.row} close={close} />);
  return (
    <>
      <div className="card"><span className="muted">선박비 합계 (차량 {voyages.length}건{bulks.length ? ` · 벌크 ${bulks.length}건` : ''})</span><div style={{ fontSize: 28, fontWeight: 800 }}>{won(total + bulkTotal)}</div>
        {bulks.length > 0 && <div className="muted small">차량 {won(total)} · 벌크 {won(bulkTotal)}</div>}
        {missing.length > 0 && <div className="banner yellow">요금 미등록 {missing.length}건 — 차량·설정 › 선박에서 요금을 넣으면 자동 계산됩니다</div>}
        {bulkMissing > 0 && <div className="banner yellow">벌크 요금 미등록 {bulkMissing}건 — 거래처 › 품목에서 "벌크 선적 요금"을 넣으세요</div>}</div>
      <table className="simple">
        <thead><tr><th>선박</th><th className="num">건수</th><th className="num">기본</th><th className="num">공차</th><th className="num">할증</th><th className="num">승선</th><th className="num">합계</th></tr></thead>
        <tbody>{byShip.map(([k, s]) => (
          <tr key={k}><td>{k}{s.missing ? <span className="muted small"> (미등록 {s.missing})</span> : ''}</td><td className="num">{s.n}</td><td className="num">{s.base || ''}</td><td className="num">{s.empty || ''}</td><td className="num">{s.surcharge || ''}</td>
            <td className="num">{s.boardingN ? `${s.boardingN}명` : ''}</td><td className="num"><b>{s.total.toLocaleString()}</b></td></tr>
        ))}</tbody>
      </table>
      {bulks.length > 0 && (
        <div className="card">
          <h3>📦 벌크 (화물만 선적) {bulks.length}건 · {won(bulkTotal)}</h3>
          {bulks.map((b) => (
            <div key={b.order.id} className="list-item" onClick={() => b.order.product_id && nav(`/products/${b.order.product_id}`)}>
              <span style={{ width: 70 }}>{fmtDate(b.date)}</span>
              <span className="grow">{b.ship} · {clientName(snap, b.order)} {productName(snap, b.order)} {qtyText(b.order)}</span>
              <b>{b.missing ? <span className="muted">{b.missing}</span> : won(b.fee)}</b>
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <h3>배편 목록 <span className="muted small">(누르면 할증·승선 수정)</span></h3>
        {list.map((v) => (
          <div key={`${v.date}-${v.row.vehicle.id}-${v.row.secondary}`} className="list-item" onClick={() => open(v)}>
            <span style={{ width: 70 }}>{fmtDate(v.date)}</span>
            <span className="grow">{v.row.vehicle.short_no} · {v.ship} · {FARE_KIND_LABEL[v.kind]}{v.manual ? '' : '(자동)'}{v.row.vd?.boarding ? ' · 👤승선' : ''}</span>
            <b>{v.missing.length ? <span className="muted">미등록</span> : won(v.total)}</b>
          </div>
        ))}
        {!showAll && voyages.length > 50 && <button style={{ width: '100%' }} onClick={() => setShowAll(true)}>전체 {voyages.length}건 보기</button>}
        {!voyages.length && <p className="muted">이 기간에 배를 탄 차량이 없습니다</p>}
      </div>
    </>
  );
}
