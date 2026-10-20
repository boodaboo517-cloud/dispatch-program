// 오더 칸을 누르면 뜨는 시트: 내용 보기·수정 + 매출 입력 + 연결 상태
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CALC_LABEL, EXTRA_PRESETS, Tx, acceptLinkPending, buildBoard, computeRevenue, deleteOrder, findLinkedUnload, ignoreLinkPending, newId,
  saveOrder, saveRevenue, setProductDefaultPrice, won,
  type BillingStatus, type CalcMethod, type DailyOrder, type OrderRevenue, type Unit,
} from '../domain/index.ts';
import { store } from '../data/store.ts';
import { QtyInput } from './QtyInput.tsx';
import { fmtDate, fmtStamp } from '../lib/time.ts';
import { useRole, useSnap, useWatch } from './hooks.ts';
import {
  STORAGE_LABEL, ZONE_LABEL, arrivalShipLabel, clientName, departureShipLabel, driverName, kindLabel, productName,
  productOf, shipText, vehicleNo,
} from './labels.ts';
import { Seg } from './Picker.tsx';
import { usePickers } from './pickers.tsx';
import { Sheet, useSheet } from './Sheet.tsx';

export const UNITS: Unit[] = ['파렛트', '대', 'm', '박스', ''];

export function StorageBadge({ storage, temp }: { storage: 'ambient' | 'chilled' | 'frozen'; temp?: string }) {
  return <span className={`badge ${storage}`}>{STORAGE_LABEL[storage]}{temp ? ` ${temp}` : ''}</span>;
}

export function tempText(p: { temp_min: number | null; temp_max: number | null }) {
  if (p.temp_min == null && p.temp_max == null) return '';
  return `${p.temp_min ?? ''}~${p.temp_max ?? ''}℃`;
}

export function OrderSheet({ orderId, close, startEditing = false }: { orderId: string; close: () => void; startEditing?: boolean }) {
  const snap = useSnap();
  const { staff } = useRole();
  const nav = useNavigate();
  const sheet = useSheet();
  const pick = usePickers();
  useWatch(orderId);
  const order = snap.daily_orders.find((o) => o.id === orderId);
  const [draft, setDraft] = useState<DailyOrder | null>(order && startEditing && staff ? { ...order } : null);
  const rev0 = snap.order_revenue.find((r) => r.order_id === orderId);
  const [rev, setRev] = useState<OrderRevenue | null>(null);
  const linkedUnload = useMemo(() => (order?.kind === 'load' ? snap.daily_orders.find((o) => o.linked_from_id === order.id) : undefined), [snap, order]);
  const source = order?.linked_from_id ? snap.daily_orders.find((o) => o.id === order.linked_from_id) : undefined;

  if (!order) {
    return <Sheet title="오더" onClose={close}><p>삭제된 오더입니다.</p></Sheet>;
  }
  const o = draft ?? order;
  const product = productOf(snap, o);
  const shipKey = o.kind === 'load' ? 'departure' : 'arrival';
  const shipLabel = o.kind === 'load' ? departureShipLabel(o.zone) : arrivalShipLabel(o.zone);
  const editing = !!draft;
  const set = (p: Partial<DailyOrder>) => setDraft({ ...(draft ?? order), ...p });

  const r: OrderRevenue = rev ?? rev0 ?? {
    id: newId(), order_id: order.id, calc_method: 'per_pallet', unit_price: null, quantity: order.quantity, extras: [],
    supply_amount: null, vat: null, total: null, bill_to_client_id: order.client_id, billing_status: '미청구',
  };
  const setR = (p: Partial<OrderRevenue>) => setRev({ ...r, ...p });
  const calc = computeRevenue({ ...r, quantity: r.quantity ?? o.quantity });

  const save = () => {
    store.run((tx) => {
      if (draft) saveOrder(tx, draft);
      if (rev) saveRevenue(tx, { ...rev, quantity: rev.quantity ?? (draft ?? order).quantity });
    });
    store.toast('저장됨');
    setDraft(null);
    setRev(null);
  };

  const remove = async () => {
    let choice: 'delete' | 'keep' = 'delete';
    const linked = order.kind === 'load' ? findLinkedUnload(new Tx(snap), order.id) : undefined;
    if (linked) {
      const a = await sheet.confirm({
        title: '오더 삭제',
        message: `연결된 하차(${fmtDate(linked.date)} ${ZONE_LABEL[linked.zone]})도 같이 삭제할까요?`,
        actions: [{ label: '하차도 함께 삭제', value: 'delete', kind: 'danger' }, { label: '상차만 삭제 (하차는 남기기)', value: 'keep' }],
      });
      if (!a) return;
      choice = a as 'delete' | 'keep';
    } else {
      const a = await sheet.confirm({ title: '오더 삭제', message: '이 오더를 삭제할까요?', actions: [{ label: '삭제', value: 'y', kind: 'danger' }] });
      if (!a) return;
    }
    store.run((tx) => deleteOrder(tx, order.id, choice));
    close();
  };

  const goto = (x: DailyOrder) => {
    close();
    nav(`/?date=${x.date}&zone=${x.zone}&focus=${x.id}`);
  };

  return (
    <Sheet
      title={`${fmtDate(o.date)} ${ZONE_LABEL[o.zone]} ${kindLabel(o.zone, o.kind)}`}
      onClose={close}
      footer={staff ? (
        <>
          {editing || rev ? (
            <>
              <button onClick={() => { setDraft(null); setRev(null); }}>취소</button>
              <button className="primary" onClick={save}>저장</button>
            </>
          ) : (
            <>
              <button className="danger" onClick={remove}>삭제</button>
              <button className="primary" onClick={() => setDraft({ ...order })}>수정</button>
            </>
          )}
        </>
      ) : undefined}
    >
      {source && (
        <div className="banner blue" onClick={() => goto(source)} style={{ cursor: 'pointer' }}>
          🔗 {fmtDate(source.date)} {ZONE_LABEL[source.zone]} 상차와 연결됨 › 원본 보기
        </div>
      )}
      {order.link_status === 'source_deleted' && <div className="banner yellow">원본 상차가 삭제되었습니다 (이 하차는 남겨 둠)</div>}
      {order.link_status === 'source_changed' && order.link_pending && (
        <div className="banner yellow">
          원본 상차가 바뀌었습니다: {Object.entries(order.link_pending).map(([k, v]) => `${k}=${v ?? '없음'}`).join(', ')}
          {staff && (
            <div className="row" style={{ marginTop: 6 }}>
              <button className="primary" onClick={() => store.run((tx) => acceptLinkPending(tx, order.id))}>반영</button>
              <button onClick={() => store.run((tx) => ignoreLinkPending(tx, order.id))}>무시</button>
            </div>
          )}
        </div>
      )}
      {linkedUnload && (
        <div className="banner blue">
          → 연결 하차: {fmtDate(linkedUnload.date)} {ZONE_LABEL[linkedUnload.zone]} {kindLabel(linkedUnload.zone, 'unload')}
          {linkedUnload.edited_manually && ' (직접 수정됨)'}
          <div className="row" style={{ marginTop: 6 }}>
            <button onClick={() => goto(linkedUnload)}>하차 보기</button>
            {staff && (
              <button onClick={async () => {
                const d = await pick.date('하차 날짜 변경', linkedUnload.date, order.date);
                if (d) store.run((tx) => saveOrder(tx, { ...linkedUnload, date: d }));
              }}>하차 날짜 변경</button>
            )}
          </div>
        </div>
      )}
      {order.source === 'recurring' && <div className="muted" style={{ margin: '6px 0' }}>🔁 반복 발주로 자동 생성{order.edited_manually ? ' · 직접 수정됨(반복 변경 시 유지)' : ''}</div>}

      <Field label="거래처" value={clientName(snap, o)} onEdit={editing ? async () => {
        const c = await pick.clientProduct(o.vehicle_id);
        if (c) set({
          client_id: c.client_id, client_text: c.client_text, product_id: c.product?.id ?? null, product_text: c.product_text,
          region: c.product?.default_region || o.region, quantity: c.product?.default_quantity ?? o.quantity, unit: c.product?.default_unit || o.unit,
        });
      } : undefined} />
      <Field label="품목" value={productName(snap, o)} extra={product && <StorageBadge storage={product.storage} temp={tempText(product)} />} onEdit={product ? () => { close(); nav(`/products/${product.id}`); } : undefined} editLabel="품목 상세 ›" />
      {editing ? (
        <>
          <label className="field"><span>지역</span><input value={o.region} onChange={(e) => set({ region: e.target.value })} /></label>
          <PlaceFields pickup={o.pickup_place ?? ''} dropoff={o.dropoff_place ?? ''} onChange={(p) => set(p)} />
          <div className="field"><span className="muted small">수량 (10파렛트 · 3대 처럼 써도 됨)</span>
            <QtyInput quantity={o.quantity} unit={o.unit} onChange={(quantity, unit) => set({ quantity, unit })} />
          </div>
          {o.kind === 'load' && (
            <label className="row" style={{ cursor: 'pointer', minHeight: 44 }}>
              <input type="checkbox" checked={!!o.same_day} onChange={(e) => set({ same_day: e.target.checked })} style={{ width: 24, minHeight: 24 }} />
              <span>당일 왕복 (반대 지역 하차도 같은 날짜)</span>
            </label>
          )}
          <Field label="비고" value={o.memo} onEdit={async () => { const m = await pick.memo(o.memo); if (m !== null) set({ memo: m }); }} />
          <Field label="날짜" value={fmtDate(o.date)} onEdit={async () => { const d = await pick.date('날짜', o.date); if (d) set({ date: d }); }} />
        </>
      ) : (
        <>
          <Field label="지역" value={o.region} />
          {(o.pickup_place || o.dropoff_place) && <Field label="상차지 → 하차지" value={`${o.pickup_place || '-'} → ${o.dropoff_place || '-'}`} />}
          <Field label="수량" value={o.quantity == null ? '' : `${o.quantity} ${o.unit}`} />
          {o.same_day && <Field label="당일 왕복" value="예 (반대 지역 하차 같은 날)" />}
          <Field label="비고" value={o.memo} />
        </>
      )}
      <Field label="차량" value={vehicleNo(snap, o.vehicle_id) || '미배차'} onEdit={editing ? async () => {
        const v = await pick.vehicle(buildBoard(snap, o.date), o.zone);
        if (v) set({ vehicle_id: v });
      } : undefined} />
      <Field label="기사" value={driverName(snap, o.driver_id) || '기사 미지정'} onEdit={editing ? async () => {
        const d = await pick.driver(o.date, o.driver_id);
        if (d !== undefined) set({ driver_id: d });
      } : undefined} />
      <Field label={shipLabel} value={shipKey === 'departure' ? shipText(o.departure_ship, o.departure_ship_tag) : shipText(o.arrival_ship, o.arrival_ship_tag)} onEdit={editing ? async () => {
        const cur = shipKey === 'departure' ? { ship: o.departure_ship, tag: o.departure_ship_tag } : { ship: o.arrival_ship, tag: o.arrival_ship_tag };
        const r2 = await pick.ship(o.zone, cur, shipKey);
        if (r2) set(shipKey === 'departure' ? { departure_ship: r2.ship, departure_ship_tag: r2.tag } : { arrival_ship: r2.ship, arrival_ship_tag: r2.tag });
      } : undefined} />
      {editing && o.vehicle_id && <button className="ghost" style={{ color: 'var(--red)' }} onClick={() => set({ vehicle_id: null })}>배차 취소 (배차 대기로)</button>}
      <div className="muted small" style={{ marginTop: 6 }}>마지막 수정 {fmtStamp(order.updated_at)}</div>

      {staff && order.source !== 'linked' && (
        <div className="card" style={{ background: '#fffbeb' }}>
          <h3>💰 매출</h3>
          <Seg value={r.calc_method} onChange={(v: CalcMethod) => setR({ calc_method: v })} options={(Object.keys(CALC_LABEL) as CalcMethod[]).map((k) => ({ value: k, label: CALC_LABEL[k] }))} />
          <div className="row">
            <label className="field grow"><span>{r.calc_method === 'fixed' ? '금액' : '단가'}</span>
              <input inputMode="numeric" value={r.unit_price ?? ''} onChange={(e) => setR({ unit_price: e.target.value === '' ? null : Number(e.target.value.replace(/,/g, '')) })} />
            </label>
            {r.calc_method !== 'fixed' && (
              <label className="field" style={{ width: 100 }}><span>수량</span>
                <input inputMode="decimal" value={r.quantity ?? o.quantity ?? ''} onChange={(e) => setR({ quantity: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
            )}
          </div>
          <div className="muted">추가 요금</div>
          {r.extras.map((x, i) => (
            <div className="row" key={i} style={{ margin: '4px 0' }}>
              <input value={x.label} style={{ width: 110 }} onChange={(e) => setR({ extras: r.extras.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} />
              <input inputMode="numeric" value={x.amount || ''} onChange={(e) => setR({ extras: r.extras.map((y, j) => (j === i ? { ...y, amount: Number(e.target.value.replace(/,/g, '')) || 0 } : y)) })} />
              <button className="ghost" onClick={() => setR({ extras: r.extras.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="row wrap" style={{ margin: '6px 0' }}>
            {[...EXTRA_PRESETS, '직접 입력'].map((l) => <button key={l} className="chip" onClick={() => setR({ extras: [...r.extras, { label: l === '직접 입력' ? '' : l, amount: 0 }] })}>＋ {l}</button>)}
          </div>
          <table className="simple">
            <tbody>
              <tr><td>공급가</td><td className="num">{won(calc.supply_amount)}</td></tr>
              <tr><td>부가세 10%</td><td className="num">{won(calc.vat)}</td></tr>
              <tr><td><b>합계</b></td><td className="num"><b>{won(calc.total)}</b></td></tr>
            </tbody>
          </table>
          <label className="field"><span>청구처</span>
            <select value={r.bill_to_client_id ?? ''} onChange={(e) => setR({ bill_to_client_id: e.target.value || null })}>
              <option value="">-</option>
              {snap.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <Seg value={r.billing_status} onChange={(v: BillingStatus) => setR({ billing_status: v })} options={(['미청구', '청구', '입금'] as BillingStatus[]).map((v) => ({ value: v, label: v }))} />
          {order.product_id && r.unit_price != null && (
            <button style={{ width: '100%', marginTop: 8 }} onClick={() => {
              store.run((tx) => setProductDefaultPrice(tx, order.product_id!, r.calc_method, r.unit_price!));
              store.toast('품목 기본 단가로 저장했습니다 (지난 오더 금액은 그대로)');
            }}>이 단가를 기본으로</button>
          )}
        </div>
      )}
      {staff && order.source === 'linked' && <div className="muted" style={{ marginTop: 8 }}>매출은 원본 상차에서 입력합니다.</div>}
    </Sheet>
  );
}

function Field(p: { label: string; value: string; onEdit?: () => void; editLabel?: string; extra?: React.ReactNode }) {
  return (
    <div className="editable" onClick={p.onEdit} style={{ cursor: p.onEdit ? 'pointer' : 'default' }}>
      <span className="k">{p.label}</span>
      <span className={`v${p.value ? '' : ' placeholder'}`}>{p.value || '-'}</span>
      {p.extra}
      {p.onEdit && <span className="muted">{p.editLabel ?? '변경 ›'}</span>}
    </div>
  );
}

/** 상차지 · 하차지 입력 (오더마다) */
export function PlaceFields(p: { pickup: string; dropoff: string; onChange: (v: { pickup_place?: string; dropoff_place?: string }) => void }) {
  return (
    <div className="row">
      <label className="field grow"><span>상차지</span><input value={p.pickup} placeholder="예: 서귀포 농협" onChange={(e) => p.onChange({ pickup_place: e.target.value })} /></label>
      <span style={{ marginTop: 22 }}>→</span>
      <label className="field grow"><span>하차지</span><input value={p.dropoff} placeholder="예: 김해 센터" onChange={(e) => p.onChange({ dropoff_place: e.target.value })} /></label>
    </div>
  );
}

/** 품목 → 거래처 순으로 등록된 상차지·하차지 주소를 기본값으로 */
export function defaultPlaces(s: { clients: { id: string; pickup_address?: string; dropoff_address?: string }[] }, clientId: string | null, product: { pickup_address: string; dropoff_address: string } | null) {
  const c = s.clients.find((x) => x.id === clientId);
  return {
    pickup_place: product?.pickup_address || c?.pickup_address || '',
    dropoff_place: product?.dropoff_address || c?.dropoff_address || '',
  };
}

/** 목록에서 고른 직후: "입력됨" + 수량만 빠르게 수정 */
export function QuickQtySheet({ orderId, close }: { orderId: string; close: () => void }) {
  const snap = useSnap();
  const o = snap.daily_orders.find((x) => x.id === orderId);
  if (!o) return null;
  const setQty = (quantity: number | null, unit: Unit) => store.run((tx) => saveOrder(tx, { ...o, quantity, unit }, { userEdit: false }));
  return (
    <Sheet title="✓ 입력됨" onClose={close} footer={<button className="primary" onClick={close}>완료</button>}>
      <p style={{ fontSize: 18 }}><b>{clientName(snap, o)}</b> {productName(snap, o)} {o.region && `· ${o.region}`}</p>
      <QtyInput big quantity={o.quantity} unit={o.unit} onChange={setQty} />
      <p className="muted">수량이 맞으면 완료를 누르세요. 칸을 길게 누르면 다시 수정할 수 있습니다.</p>
    </Sheet>
  );
}
