// 업체별 청구: 원하는 업체만 골라 매출 보기 · 건별/여러 건 미청구·청구·입금 바꾸기 · 청구 내역서
import { useMemo, useState } from 'react';
import { revenueLines, saveRevenue, won, type BillingStatus, type RevenueLine } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { exportBilling } from '../excel/exportOther.ts';
import { fmtDate } from '../lib/time.ts';
import { useSnap } from '../ui/hooks.ts';
import { clientName, productName, qtyText, vehicleNo } from '../ui/labels.ts';
import { OrderSheet } from '../ui/OrderSheet.tsx';
import { Sheet, useSheet } from '../ui/Sheet.tsx';

const STATUSES: BillingStatus[] = ['미청구', '청구', '입금'];
const KEY = 'billing-clients';
const billTo = (l: RevenueLine) => l.rev?.bill_to_client_id ?? l.order.client_id ?? '';

function loadPicked(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

function ClientPicker({ options, picked, close, onSave }: { options: { id: string; name: string; total: number; n: number }[]; picked: string[]; close: () => void; onSave: (ids: string[]) => void }) {
  const [sel, setSel] = useState(new Set(picked));
  const [q, setQ] = useState('');
  const shown = options.filter((o) => !q || o.name.includes(q));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Sheet title="업체 선택" onClose={close} footer={<>
      <button onClick={() => { onSave([]); close(); }}>전체 업체</button>
      <button className="primary" onClick={() => { onSave([...sel]); close(); }}>{sel.size ? `${sel.size}곳 보기` : '전체 보기'}</button>
    </>}>
      <input placeholder="업체 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ marginTop: 8 }}>
        {shown.map((o) => (
          <label key={o.id} className="list-item" style={{ gap: 8 }}>
            <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} style={{ width: 22, height: 22 }} />
            <span className="grow">{o.name} <span className="muted small">{o.n}건</span></span>
            <b>{won(o.total)}</b>
          </label>
        ))}
        {!shown.length && <p className="muted">이 기간에 매출이 있는 업체가 없습니다</p>}
      </div>
    </Sheet>
  );
}

export function BillingPanel({ from, to }: { from: string; to: string }) {
  const snap = useSnap();
  const sheet = useSheet();
  const [picked, setPicked] = useState<string[]>(loadPicked);
  const [status, setStatus] = useState<BillingStatus | 'all'>('all');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const lines = useMemo(() => revenueLines(snap, from, to), [snap, from, to]);
  const options = useMemo(() => {
    const m = new Map<string, { id: string; name: string; total: number; n: number }>();
    for (const l of lines) {
      const id = billTo(l);
      if (!id) continue;
      const cur = m.get(id) ?? { id, name: snap.clients.find((c) => c.id === id)?.name ?? clientName(snap, l.order), total: 0, n: 0 };
      cur.total += l.rev?.total ?? 0;
      cur.n++;
      m.set(id, cur);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [lines, snap]);
  const mine = lines.filter((l) => !picked.length || picked.includes(billTo(l)));
  const shown = mine.filter((l) => status === 'all' || (l.rev?.total != null && l.rev.billing_status === status));
  const sumOf = (s: BillingStatus) => mine.filter((l) => l.rev?.total != null && l.rev.billing_status === s).reduce((a, l) => a + (l.rev!.total ?? 0), 0);
  const total = mine.reduce((a, l) => a + (l.rev?.total ?? 0), 0);
  const missing = mine.filter((l) => l.rev?.total == null).length;
  const priced = shown.filter((l) => l.rev?.total != null);
  const allChecked = priced.length > 0 && priced.every((l) => checked.has(l.order.id));

  const savePicked = (ids: string[]) => {
    setPicked(ids);
    setChecked(new Set());
    try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* 무시 */ }
  };
  const setLineStatus = (ids: string[], s: BillingStatus) => {
    store.run((tx) => {
      for (const r of tx.list('order_revenue').filter((r) => ids.includes(r.order_id) && r.total != null)) saveRevenue(tx, { ...r, billing_status: s });
    });
    store.toast(`${ids.length}건 → ${s}`);
    setChecked(new Set());
  };
  const toggle = (id: string) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const names = picked.map((id) => options.find((o) => o.id === id)?.name ?? snap.clients.find((c) => c.id === id)?.name ?? '').filter(Boolean);

  return (
    <>
      <div className="row wrap" style={{ gap: 6, alignItems: 'center', margin: '6px 0' }}>
        <button className="primary" onClick={() => sheet.open((close) => <ClientPicker options={options} picked={picked} close={close} onSave={savePicked} />)}>🏢 업체 선택</button>
        {picked.length ? (
          <>
            {names.map((n) => <span key={n} className="chip on">{n}</span>)}
            <button className="chip" onClick={() => savePicked([])}>✕ 전체 업체로</button>
          </>
        ) : <span className="muted">전체 업체</span>}
      </div>

      <div className="admin-cards">
        <div className="admin-card"><span>합계 ({mine.length}건)</span><b>{won(total)}</b></div>
        {STATUSES.map((s) => (
          <button key={s} className={`admin-card ${status === s ? 'on' : ''}`} onClick={() => setStatus(status === s ? 'all' : s)} style={{ textAlign: 'left', cursor: 'pointer' }}>
            <span>{s}</span><b>{won(sumOf(s))}</b>
          </button>
        ))}
        {missing > 0 && <div className="admin-card warn"><span>금액 미입력</span><b>{missing}건</b></div>}
      </div>

      <div className="row wrap" style={{ gap: 6, alignItems: 'center', margin: '6px 0' }}>
        <span className="muted small">{status === 'all' ? '전체 상태' : `${status}만`} · {checked.size}건 선택</span>
        {STATUSES.map((s) => <button key={s} disabled={!checked.size} onClick={() => setLineStatus([...checked], s)}>선택 → {s}</button>)}
        <span className="grow" />
        <button onClick={() => void exportBilling(snap, from, to, picked.length ? picked : undefined)}>⬇ 청구 내역서 (엑셀)</button>
      </div>

      <div className="admin-table-wrap">
        <table className="simple admin-table">
          <thead>
            <tr>
              <th><input type="checkbox" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(priced.map((l) => l.order.id)))} style={{ width: 20, height: 20 }} /></th>
              <th>날짜</th><th>업체</th><th>품목 · 수량</th><th>차량</th><th className="num">합계</th><th>상태</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const has = l.rev?.total != null;
              return (
                <tr key={l.order.id}>
                  <td>{has && <input type="checkbox" checked={checked.has(l.order.id)} onChange={() => toggle(l.order.id)} style={{ width: 20, height: 20 }} />}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.order.date)}</td>
                  <td>{snap.clients.find((c) => c.id === billTo(l))?.name ?? clientName(snap, l.order)}</td>
                  <td style={{ cursor: 'pointer' }} onClick={() => sheet.open((c) => <OrderSheet orderId={l.order.id} close={c} />)}>{productName(snap, l.order)} {qtyText(l.order)} <span className="muted small">›</span></td>
                  <td>{vehicleNo(snap, l.order.vehicle_id) || '-'}</td>
                  <td className="num"><b>{has ? won(l.rev!.total) : <span className="muted">미입력</span>}</b></td>
                  <td>
                    {has ? (
                      <select value={l.rev!.billing_status} onChange={(e) => setLineStatus([l.order.id], e.target.value as BillingStatus)} style={{ width: 'auto', minHeight: 36 }}>
                        {STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    ) : <span className="muted small">금액 먼저</span>}
                  </td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={7} className="muted">해당 매출이 없습니다</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
