// 매출 보기 (관리자·배차 전용 — 기사·조회 계정은 서버에서 금액 행 자체를 받지 못함)
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { revenueLines, saveRevenue, sumBy, won, type BillingStatus } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { exportBilling, exportRevenue } from '../excel/exportOther.ts';
import { dayjs, fmtDate, seoulToday } from '../lib/time.ts';
import { useRole, useSnap } from '../ui/hooks.ts';
import { clientName, productName, qtyText, vehicleNo } from '../ui/labels.ts';
import { OrderSheet } from '../ui/OrderSheet.tsx';
import { useSheet } from '../ui/Sheet.tsx';
import { ShipCostPanel } from './ShipCostPanel.tsx';
import { BillingPanel } from './BillingPanel.tsx';

type Group = 'day' | 'month' | 'client' | 'vehicle';

export function RevenuePage() {
  const snap = useSnap();
  const sheet = useSheet();
  const { admin: staff } = useRole(); // 매출은 관리자만 (설정 안 메뉴)
  const nav = useNavigate();
  const today = seoulToday();
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(dayjs(today).endOf('month').format('YYYY-MM-DD'));
  const [group, setGroup] = useState<Group>('client');
  const [view, setView] = useState<'revenue' | 'billing' | 'ship'>('revenue');
  const lines = useMemo(() => revenueLines(snap, from, to), [snap, from, to]);
  const sums = useMemo(() => sumBy(lines, (l) => {
    if (group === 'day') return l.order.date;
    if (group === 'month') return l.order.date.slice(0, 7);
    if (group === 'client') return snap.clients.find((c) => c.id === (l.rev?.bill_to_client_id ?? l.order.client_id))?.name ?? clientName(snap, l.order) ?? '-';
    return vehicleNo(snap, l.order.vehicle_id) || '미배차';
  }), [lines, group, snap]);
  if (!staff) return <div className="page"><p>권한이 없습니다.</p></div>;
  const total = [...sums.values()].reduce((a, s) => a + s.total, 0);
  const missing = lines.filter((l) => l.rev?.total == null);
  const unbilled = lines.filter((l) => l.rev?.total != null && l.rev.billing_status === '미청구');
  const unpaid = lines.filter((l) => l.rev?.billing_status === '청구');
  const setStatus = (ids: string[], s: BillingStatus) => store.run((tx) => {
    for (const r of tx.list('order_revenue').filter((r) => ids.includes(r.order_id))) saveRevenue(tx, { ...r, billing_status: s });
  });
  const List = ({ title, ls, next, back }: { title: string; ls: typeof lines; next?: BillingStatus; back?: BillingStatus }) => (
    <div className="card">
      <div className="row"><h3 className="grow">{title} {ls.length}건</h3>
        {back && ls.length > 0 && <button onClick={() => confirm(`${ls.length}건을 모두 ${back}(으)로 되돌릴까요?`) && setStatus(ls.map((l) => l.order.id), back)}>↩ 모두 {back}</button>}
        {next && ls.length > 0 && <button onClick={() => setStatus(ls.map((l) => l.order.id), next)}>모두 {next}</button>}</div>
      {ls.slice(0, 100).map((l) => (
        <div key={l.order.id} className="list-item" onClick={() => sheet.open((c) => <OrderSheet orderId={l.order.id} close={c} />)}>
          <span style={{ width: 80 }}>{fmtDate(l.order.date)}</span>
          <span className="grow">{clientName(snap, l.order)} {productName(snap, l.order)} {qtyText(l.order)}</span>
          <b>{won(l.rev?.total)}</b>
        </div>
      ))}
    </div>
  );
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <button className="ghost" style={{ marginBottom: 4 }} onClick={() => nav('/settings')}>← 설정</button>
      <div className="row" style={{ alignItems: 'center' }}>
        <h2 className="grow">{view === 'revenue' ? '매출' : view === 'billing' ? '업체별 청구' : '선박비'}</h2>
        <div className="seg fp-seg">
          <button className={view === 'revenue' ? 'on' : ''} onClick={() => setView('revenue')}>💰 매출</button>
          <button className={view === 'billing' ? 'on' : ''} onClick={() => setView('billing')}>🧾 청구</button>
          <button className={view === 'ship' ? 'on' : ''} onClick={() => setView('ship')}>🚢 선박비</button>
        </div>
      </div>
      <div className="row wrap">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} />~
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} />
        <button onClick={() => { const m = dayjs(from).subtract(1, 'month'); setFrom(m.format('YYYY-MM-01')); setTo(m.endOf('month').format('YYYY-MM-DD')); }}>◀ 전월</button>
        <button onClick={() => { const m = dayjs(from).add(1, 'month'); setFrom(m.format('YYYY-MM-01')); setTo(m.endOf('month').format('YYYY-MM-DD')); }}>익월 ▶</button>
      </div>
      {view === 'ship' ? <ShipCostPanel from={from} to={to} /> : view === 'billing' ? <BillingPanel from={from} to={to} /> : (<>
      <div className="card"><span className="muted">합계(부가세 포함)</span><div style={{ fontSize: 28, fontWeight: 800 }}>{won(total)}</div>
        {missing.length > 0 && <div className="banner yellow">금액 미입력 오더 {missing.length}건</div>}</div>
      <div className="tabs">{([['day', '일별'], ['month', '월별'], ['client', '거래처별'], ['vehicle', '차량별']] as [Group, string][]).map(([g, l]) => <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>{l}</button>)}</div>
      <table className="simple">
        <thead><tr><th>{{ day: '날짜', month: '월', client: '거래처', vehicle: '차량' }[group]}</th><th className="num">건수</th><th className="num">공급가</th><th className="num">부가세</th><th className="num">합계</th><th className="num">미입력</th></tr></thead>
        <tbody>{[...sums.entries()].sort((a, b) => (group === 'client' ? b[1].total - a[1].total : a[0].localeCompare(b[0]))).map(([k, s]) => (
          <tr key={k}><td>{k}</td><td className="num">{s.count}</td><td className="num">{s.supply.toLocaleString()}</td><td className="num">{s.vat.toLocaleString()}</td><td className="num"><b>{s.total.toLocaleString()}</b></td><td className="num">{s.missing || ''}</td></tr>
        ))}</tbody>
      </table>
      <div className="row wrap" style={{ marginTop: 10 }}>
        <button onClick={() => exportBilling(snap, from, to)}>⬇ 거래처별 청구 내역서</button>
        <button onClick={() => exportRevenue(snap, from, to)}>⬇ 매출 목록</button>
      </div>
      <List title="금액 미입력" ls={missing} />
      <List title="미청구" ls={unbilled} next="청구" />
      <List title="미입금 (청구됨)" ls={unpaid} next="입금" back="미청구" />
      <p className="muted small">한 건씩 바꾸거나 원하는 업체만 보려면 위 <b>🧾 청구</b>를 누르세요.</p>
      </>)}
    </div>
  );
}
