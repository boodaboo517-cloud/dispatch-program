// 오더 칸을 누르면 뜨는 시트: 내용 보기·수정 + 매출 입력 + 연결 상태
import { NightTag } from './NightTag.tsx';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CALC_LABEL, CARRIER_LABEL, EXTRA_PRESETS, Tx, acceptLinkPending, arrivalOffset, buildBoard, transportSummary,
  type CarrierType, type Shipment, computeRevenue, deleteOrder, findLinkedUnload, ignoreLinkPending, newId,
  copyOrder, createOrder, isPerVehicleSplittable, addDays, saveOrder, saveRevenue, splitPerVehicle, workText, setProductDefaultPrice, won,
  type BillingStatus, type CalcMethod, type DailyOrder, type OrderRevenue, type Unit, postponeUnload, type UnloadHold, unassignOrder,
} from '../domain/index.ts';
import { store } from '../data/store.ts';
import { QtyInput } from './QtyInput.tsx';
import { PhraseChips } from './Phrases.tsx';
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

  /** 배차 못 한 짐을 다른 날로 */
  const moveDate = async () => {
    const d = await pick.date(`${kindLabel(order.zone, order.kind)} 날짜 변경`, order.date);
    if (!d || d === order.date) return;
    store.run((tx) => saveOrder(tx, { ...tx.get('daily_orders', order.id)!, date: d }));
    store.toast(`${fmtDate(d)}로 옮겼습니다`);
    close();
  };

  /** 같은 거래처의 다른 품목을 같은 차량·기사·선박으로 한 건 더 */
  const addSameClient = async () => {
    const c = await pick.clientProduct(order.vehicle_id, { id: order.client_id!, text: order.client_text });
    if (!c || (!c.product && !c.product_text)) return;
    const s = store.getState().snap;
    const same = s.daily_orders.filter((x) => x.date === order.date && x.zone === order.zone && x.kind === order.kind);
    const next: DailyOrder = {
      ...order, id: newId(),
      product_id: c.product?.id ?? null, product_text: c.product_text,
      quantity: c.product?.default_quantity ?? null, unit: c.product?.default_unit ?? '',
      region: c.product?.default_region || order.region,
      ...defaultPlaces(s, order.client_id, c.product),
      source: 'manual', recurring_order_id: null, recurring_version_id: null, edited_manually: false,
      linked_from_id: null, link_status: 'none', link_pending: null, sort_order: same.length,
    };
    store.run((tx) => createOrder(tx, next));
    close();
    sheet.open((c2) => <QuickQtySheet orderId={next.id} close={c2} />);
  };

  const r: OrderRevenue = rev ?? rev0 ?? {
    id: newId(), order_id: order.id, calc_method: 'per_pallet', unit_price: null, quantity: order.quantity, extras: [],
    supply_amount: null, vat: null, total: null, bill_to_client_id: order.client_id, billing_status: '미청구',
  };
  const setR = (p: Partial<OrderRevenue>) => setRev({ ...r, ...p });
  const calc = computeRevenue({ ...r, quantity: r.quantity ?? o.quantity });

  const save = () => {
    let split = 0;
    store.run((tx) => {
      if (draft) saveOrder(tx, draft);
      if (rev) saveRevenue(tx, { ...rev, quantity: rev.quantity ?? (draft ?? order).quantity });
      if (draft) split = splitPerVehicle(tx, draft.id).length - 1;
    });
    store.toast(split ? `저장됨 · 1대씩 나눠 배차 대기 ${split}건 추가` : '저장됨');
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

  /** 배차 취소 → 미배차(배차 대기)로 */
  const assigned = !!order.vehicle_id || (order.carrier_type ?? 'own') !== 'own';
  const cancelAssign = async () => {
    const linked = order.kind === 'load' ? findLinkedUnload(new Tx(snap), order.id) : undefined;
    const who = order.vehicle_id ? `${vehicleNo(snap, order.vehicle_id)} 차량` : '용차·화주배차';
    const a = await sheet.confirm({
      title: '배차 취소',
      message: `${who} 배차를 취소하고 미배차(배차 대기)로 돌립니다.${linked && linked.vehicle_id === order.vehicle_id ? ` 연결된 ${fmtDate(linked.date)} ${ZONE_LABEL[linked.zone]} 하차도 미배차가 됩니다.` : ''}`,
      actions: [{ label: '배차 취소 (미배차로)', value: 'y', kind: 'danger' }],
    });
    if (!a) return;
    store.run((tx) => unassignOrder(tx, order.id));
    store.toast(`${who} 배차를 취소했습니다 → 미배차`);
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
              {assigned && <button onClick={() => void cancelAssign()}>🚫 배차 취소</button>}
              {order.client_id && order.source !== 'linked' && <button onClick={() => void addSameClient()}>＋ 같은 거래처 품목</button>}
              <button onClick={() => sheet.open((c) => <CopySheet order={order} close={c} onDone={close} />)}>📋 복사</button>
              {!order.vehicle_id && <button onClick={() => void moveDate()}>📅 날짜 변경</button>}
              {order.kind === 'unload' && order.vehicle_id && (
                <button onClick={() => {
                  const sails = buildBoard(store.getState().snap, order.date).rows.find((r) => r.vehicle.id === order.vehicle_id && !r.secondary)?.departureShip;
                  store.run((tx) => postponeUnload(tx, order.id));
                  store.toast(sails ? `하차를 내일로 미뤘습니다. 이 차량에 오늘 출발 선박(${sails})이 있어 내일 위치가 바뀝니다 — 선박을 확인하세요` : '하차를 내일 오전으로 미뤘습니다 (차량은 짐을 실은 채 대기)', sails ? 'warn' : undefined);
                  close();
                }}>⏸ 하차 연기 (내일로)</button>
              )}
              {isPerVehicleSplittable(order) && <button onClick={() => { let n = 0; store.run((tx) => { n = splitPerVehicle(tx, order.id).length; }); store.toast(`1대씩 ${n}건으로 나눴습니다 (나머지는 배차 대기)`); close(); }}>대당 나누기</button>}
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
      {editing ? (
        <>
          <Field label="품목" value={productName(snap, o)} extra={product && <StorageBadge storage={product.storage} temp={tempText(product)} />} onEdit={async () => {
            const c = await pick.clientProduct(o.vehicle_id, o.client_id ? { id: o.client_id, text: clientName(snap, o) } : undefined);
            if (c) set({
              client_id: c.client_id, client_text: c.client_text, product_id: c.product?.id ?? null, product_text: c.product_text,
              region: c.product?.default_region || o.region, unit: c.product?.default_unit || o.unit,
            });
          }} editLabel="품목 변경 ›" />
        </>
      ) : (
        <Field label="품목" value={productName(snap, o)} extra={product && <StorageBadge storage={product.storage} temp={tempText(product)} />} onEdit={product ? () => { close(); nav(`/products/${product.id}`); } : undefined} editLabel="품목 상세 ›" />
      )}
      {editing ? (
        <>
          <label className="field"><span>지역</span><input value={o.region} onChange={(e) => set({ region: e.target.value })} /></label>
          <PlaceFields pickup={o.pickup_place ?? ''} dropoff={o.dropoff_place ?? ''} onChange={(p) => set(p)} />
          <label className="row night-toggle">
            <input type="checkbox" checked={!!o.night} onChange={(e) => set({ night: e.target.checked })} style={{ width: 24, height: 24 }} />
            <span><NightTag /> 작업</span>
          </label>
          <WorkFields kind={o.kind} time={o.work_time ?? ''} detail={o.work_detail ?? ''} onChange={(p) => set(p)} />
          <div className="field"><span className="muted small">수량 (10파렛트 · 3대 처럼 써도 됨)</span>
            <QtyInput quantity={o.quantity} unit={o.unit} onChange={(quantity, unit) => set({ quantity, unit })} />
          </div>
          <TransportFields o={o} set={set} />
          <Field label="비고" value={o.memo} onEdit={async () => { const m = await pick.memo(o.memo); if (m !== null) set({ memo: m }); }} />
          <Field label="날짜" value={fmtDate(o.date)} onEdit={async () => { const d = await pick.date('날짜', o.date); if (d) set({ date: d }); }} />
        </>
      ) : (
        <>
          <Field label="지역" value={o.region} />
          {(o.pickup_place || o.dropoff_place) && <Field label="상차지 → 하차지" value={`${o.pickup_place || '-'} → ${o.dropoff_place || '-'}`} />}
          {workText(o) && <Field label="세부" value={workText(o)} />}
          <Field label="수량" value={o.quantity == null ? '' : `${o.quantity} ${o.unit}`} />
          {transportSummary(snap, o) && <Field label="운송" value={transportSummary(snap, o)} />}
          <Field label="비고" value={o.memo} />
        </>
      )}
      {(o.carrier_type ?? 'own') === 'own' && <Field label="차량" value={vehicleNo(snap, o.vehicle_id) || '미배차'} onEdit={editing ? async () => {
        const v = await pick.vehicle(buildBoard(snap, o.date), o.zone);
        if (v) set({ vehicle_id: v });
      } : undefined} />}
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

/** 운송 방법: 직영/용차/화주배차, 차량째/벌크, 하차 날짜, 당일 왕복 */
export function TransportFields({ o, set }: { o: DailyOrder; set: (p: Partial<DailyOrder>) => void }) {
  const snap = useSnap();
  const ct = o.carrier_type ?? 'own';
  const isLoad = o.kind === 'load';
  const bulk = o.shipment === 'bulk';
  const shipDays = arrivalOffset(snap, o.departure_ship);
  return (
    <div className="card" style={{ background: '#f8fafc' }}>
      <div className="muted small">운송</div>
      <Seg value={ct} onChange={(v: CarrierType) => set(v === 'own' ? { carrier_type: v } : { carrier_type: v, vehicle_id: null, same_day: false })}
        options={(Object.keys(CARRIER_LABEL) as CarrierType[]).map((k) => ({ value: k, label: CARRIER_LABEL[k] }))} />
      {ct !== 'own' && (
        <>
          <div className="row" style={{ marginTop: 6 }}>
            <input placeholder={ct === 'hired' ? '용차 업체·기사' : '화주 쪽 업체·기사 (모르면 비움)'} value={o.carrier_name ?? ''} onChange={(e) => set({ carrier_name: e.target.value })} />
            <input placeholder="차량번호" style={{ width: 130 }} value={o.carrier_vehicle ?? ''} onChange={(e) => set({ carrier_vehicle: e.target.value })} />
          </div>
          <input type="tel" placeholder="연락처" style={{ marginTop: 6 }} value={o.carrier_phone ?? ''} onChange={(e) => set({ carrier_phone: e.target.value })} />
          <div className="muted small" style={{ marginTop: 4 }}>{ct === 'hired' ? '외부 차량이라 배차 대기로 세지 않고 "용차·화주배차"에 따로 모입니다.' : '화주가 직접 차를 보내는 건입니다. 배차 대기로 세지 않습니다.'}</div>
        </>
      )}
      {isLoad && (
        <>
          <div className="muted small" style={{ marginTop: 10 }}>선적</div>
          <Seg value={o.shipment ?? 'vehicle'} onChange={(v: Shipment) => set(v === 'bulk' ? { shipment: v, same_day: false } : { shipment: v })}
            options={[{ value: 'vehicle', label: '차량째 선적' }, { value: 'bulk', label: '벌크 (화물만)' }]} />
          {bulk && <div className="muted small" style={{ marginTop: 4 }}>차량은 배를 타지 않고 남습니다. 반대편 하차는 <b>차량 없이</b> 들어가 도착지에서 다시 배차합니다.</div>}
          <div className="muted small" style={{ marginTop: 10 }}>반대편 하차 날짜</div>
          <div className="seg">
            {([null, 0, 1, 2] as (number | null)[]).map((v) => (
              <button key={String(v)} type="button" disabled={!!o.same_day}
                className={(o.arrival_offset ?? null) === v && !o.same_day ? 'on' : ''}
                onClick={() => set({ arrival_offset: v })}>
                {v === null ? `기본 +${shipDays}일` : v === 0 ? '같은 날' : `+${v}일`}
              </button>
            ))}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>선박·벌크 마감으로 다음 배를 타면 +1일 더 늦게 고르세요.</div>
          <div className="muted small" style={{ marginTop: 10 }}>고객 지정 하차일</div>
          <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" value={o.unload_date ?? ''} min={o.date} style={{ width: 'auto' }}
              onChange={(e) => set(e.target.value ? { unload_date: e.target.value, unload_hold: o.unload_hold || 'vehicle', same_day: false } : { unload_date: null, unload_hold: '' })} />
            {o.unload_date && <button type="button" className="chip" onClick={() => set({ unload_date: null, unload_hold: '' })}>지정 안 함</button>}
          </div>
          {o.unload_date && (
            <>
              <Seg value={o.unload_hold || 'vehicle'} onChange={(v: UnloadHold) => set({ unload_hold: v })}
                options={[{ value: 'vehicle', label: '🚚 차량 대기' }, { value: 'storage', label: '🏬 창고 보관' }]} />
              <div className="muted small" style={{ marginTop: 4 }}>
                {(o.unload_hold || 'vehicle') === 'vehicle'
                  ? '배가 도착한 뒤 지정일까지 이 차량이 짐을 실은 채 대기하고, 지정일에 이 차량으로 하차합니다.'
                  : '도착한 날 창고에 내려 보관하고, 지정일 하차는 차량 없이 배차 대기로 들어가 그날 따로 배차합니다.'}
              </div>
            </>
          )}
          {!bulk && ct === 'own' && (
            <label className="row" style={{ cursor: 'pointer', minHeight: 44, marginTop: 6 }}>
              <input type="checkbox" checked={!!o.same_day} onChange={(e) => set({ same_day: e.target.checked })} style={{ width: 24, minHeight: 24 }} />
              <span>당일 왕복 <span className="muted small">(차량이 올라가 상차하고 같은 날 돌아옴)</span></span>
            </label>
          )}
        </>
      )}
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

/** 상·하차 세부: 작업 시간 + 내용 (예: 08:40 · 막걸리공병 하차지원) */
export function WorkFields(p: { kind: DailyOrder['kind']; time: string; detail: string; onChange: (v: { work_time?: string; work_detail?: string }) => void }) {
  const word = p.kind === 'load' ? '상차' : '하차';
  return (
    <>
    <div className="row" style={{ alignItems: 'flex-end' }}>
      <label className="field" style={{ width: 130, flex: 'none' }}><span>{word} 시간</span>
        <input type="time" value={p.time} onChange={(e) => p.onChange({ work_time: e.target.value })} />
      </label>
      <label className="field grow"><span>{word} 세부 내용</span>
        <input value={p.detail} placeholder={`예: 막걸리공병 ${word}지원`} onChange={(e) => p.onChange({ work_detail: e.target.value })} />
      </label>
    </div>
    <PhraseChips settingKey="work_phrases" defaults={['하차지원', '상차지원', '공병 회수']} label="자주 쓰는 세부 내용" onPick={(ph) => p.onChange({ work_detail: p.detail ? `${p.detail} ${ph}` : ph })} />
    </>
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
/** 오더 복사: 날짜 고르기 + 차량·기사도 같이 */
function CopySheet({ order, close, onDone }: { order: DailyOrder; close: () => void; onDone: () => void }) {
  const [date, setDate] = useState(order.date);
  const [keepVehicle, setKeepVehicle] = useState(false);
  const run = () => {
    let ids: string[] = [];
    store.run((tx) => { ids = copyOrder(tx, order.id, { date, keepVehicle: keepVehicle && !!order.vehicle_id }); });
    store.toast(`${fmtDate(date)}로 복사했습니다${ids.length > 1 ? ` (1대씩 ${ids.length}건)` : ''}${keepVehicle && order.vehicle_id ? '' : ' · 배차 대기'}`);
    close();
    onDone();
  };
  return (
    <Sheet title="오더 복사" onClose={close} footer={<button className="primary" onClick={run}>복사</button>}>
      <div className="field">
        <span>복사할 날짜</span>
        <div className="row">
          <button onClick={() => setDate(addDays(date, -1))}>◀</button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button onClick={() => setDate(addDays(date, 1))}>▶</button>
        </div>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', marginTop: 6 }}>
          {[['같은 날', 0], ['다음 날', 1], ['모레', 2], ['일주일 뒤', 7]].map(([l, n]) => (
            <button key={l} className={`chip ${date === addDays(order.date, n as number) ? 'on' : ''}`} onClick={() => setDate(addDays(order.date, n as number))}>{l}</button>
          ))}
        </div>
      </div>
      {order.vehicle_id && (
        <label className="row" style={{ gap: 8, margin: '10px 0' }}>
          <input type="checkbox" style={{ width: 22, height: 22 }} checked={keepVehicle} onChange={(e) => setKeepVehicle(e.target.checked)} />
          <span>차량·기사도 같이 복사 ({vehicleNo(store.getState().snap, order.vehicle_id)})</span>
        </label>
      )}
      <p className="muted small">거래처·품목·수량·선박·상차지·비고·금액이 그대로 복사됩니다. 차량을 같이 복사하지 않으면 배차 대기로 들어갑니다.</p>
    </Sheet>
  );
}

export function QuickQtySheet({ orderId, close, onAddMore }: { orderId: string; close: () => void; onAddMore?: () => void }) {
  const snap = useSnap();
  const o = snap.daily_orders.find((x) => x.id === orderId);
  const product = o?.product_id ? snap.products.find((x) => x.id === o.product_id) : undefined;
  // 품목에 기본 수량·단위가 아직 없으면, 여기서 넣은 값을 다음부터 쓰도록 기본값으로 저장 (기본 체크)
  const [remember, setRemember] = useState(() => !!product && product.default_quantity == null && !product.default_unit);
  if (!o) return null;
  const setQty = (quantity: number | null, unit: Unit) => store.run((tx) => saveOrder(tx, { ...o, quantity, unit }, { userEdit: false }));
  const done = () => {
    if (remember && product && (o.quantity != null || o.unit)) {
      store.run((tx) => tx.update('products', product.id, { default_quantity: o.quantity, default_unit: o.unit }));
    }
    if (isPerVehicleSplittable(o)) {
      const n = o.quantity!;
      store.run((tx) => { splitPerVehicle(tx, o.id); });
      store.toast(`${n}대 → 1대씩 ${n}건으로 나눴습니다 (나머지는 배차 대기)`);
    }
    close();
  };
  return (
    <Sheet title="✓ 입력됨" onClose={done} footer={<>
      {onAddMore && <button onClick={() => { done(); onAddMore(); }}>＋ 같은 거래처 다른 품목</button>}
      <button className="primary" onClick={done}>완료</button>
    </>}>
      <p style={{ fontSize: 18 }}><b>{clientName(snap, o)}</b> {productName(snap, o)} {o.region && `· ${o.region}`}</p>
      <QtyInput big quantity={o.quantity} unit={o.unit} onChange={setQty} />
      <WorkFields kind={o.kind} time={o.work_time ?? ''} detail={o.work_detail ?? ''}
        onChange={(p) => store.run((tx) => saveOrder(tx, { ...o, ...p }, { userEdit: false }))} />
      {isPerVehicleSplittable(o) && <div className="banner blue">완료를 누르면 {o.quantity}대 → 오더 {o.quantity}건으로 나눕니다 (첫 건은 이 차량, 나머지는 배차 대기)</div>}
      {product && (
        <label className="row" style={{ marginTop: 8, gap: 8 }}>
          <input type="checkbox" style={{ width: 22, height: 22 }} checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>다음에도 이 수량·단위로 ({product.name} 기본값 저장)</span>
        </label>
      )}
      <p className="muted">수량이 맞으면 완료를 누르세요. 칸을 길게 누르면 다시 수정할 수 있습니다.</p>
    </Sheet>
  );
}
