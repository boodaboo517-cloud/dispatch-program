// 오더 입력: 구역 → 구분 → 거래처 → 품목·지역 자동 → 수량·단위 → 차량·기사·선박 → 비고 → 매주 반복
import { NightTag } from '../ui/NightTag.tsx';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CALC_LABEL, computeRevenue, saveRevenue, won, assignVehicle, waitsForShip, blankOrder, buildBoard, createOrder, isPerVehicleSplittable, newId, splitPerVehicle, planCreateRecurring, weekdayOf,
  type CalcMethod, type DailyOrder, type Kind, type Product, type Unit, type Weekday, type Zone,
} from '../domain/index.ts';
import { store } from '../data/store.ts';
import { fmtDate, seoulToday } from '../lib/time.ts';
import { boardView } from '../lib/boardDate.ts';
import { useRole, useSnap } from '../ui/hooks.ts';
import { arrivalShipLabel, clientName, departureShipLabel, driverName, kindLabel, productName, shipText, vehicleNo } from '../ui/labels.ts';
import { PlaceFields, TransportFields, WorkFields, defaultPlaces } from '../ui/OrderSheet.tsx';
import { QtyInput } from '../ui/QtyInput.tsx';
import { Seg, WeekdayChips } from '../ui/Picker.tsx';
import { usePickers } from '../ui/pickers.tsx';

interface Extra { key: string; product: Product | null; product_text: string; quantity: number | null; unit: Unit }

export function OrderInputPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const snap = useSnap();
  const pick = usePickers();
  // 날짜·구역 기본값: 주소에 있으면 그것, 없으면 배차 화면에서 보던 날짜·구역, 없으면 오늘
  const [o, setO] = useState<DailyOrder>(() => blankOrder({
    date: params.get('date') ?? boardView()?.date ?? seoulToday(),
    zone: ((params.get('zone') ?? boardView()?.zone) === 'jeju' ? 'jeju' : 'land') as Zone,
    kind: params.get('kind') === 'unload' ? 'unload' : 'load',
  }));
  const [repeat, setRepeat] = useState(false);
  /** 간편 입력(날짜·구역·구분·거래처·품목·수량) → "추가 내용"을 누르면 나머지 */
  const [more, setMore] = useState(false);
  /** 같은 거래처에서 함께 나가는 다른 품목들 (저장하면 품목마다 오더 1건) */
  const [extras, setExtras] = useState<Extra[]>([]);
  /** "N대"면 오더 N건으로 나눠 저장 — 2번째부터 차량 (비우면 배차 대기) */
  const [moreVehicles, setMoreVehicles] = useState<(string | null)[]>([]);
  const own = (o.carrier_type ?? 'own') === 'own';
  const perVehicle = isPerVehicleSplittable({ ...o, source: 'manual' }) ? o.quantity! : 0;
  const [weekdays, setWeekdays] = useState<Weekday[]>([weekdayOf(o.date)]);
  const set = (p: Partial<DailyOrder>) => setO({ ...o, ...p });
  const isLoad = o.kind === 'load';
  // 금액(매출): 품목 기본 단가가 있으면 채워 두고, 바꾸면 이 오더만 그 금액으로 (배차 담당·관리자만)
  const { staff } = useRole();
  const [calc, setCalc] = useState<CalcMethod>('per_pallet');
  const [price, setPrice] = useState<number | null>(null);
  const [priceTouched, setPriceTouched] = useState(false);
  const preview = computeRevenue({ calc_method: calc, unit_price: price, quantity: o.quantity, extras: [] });
  const priceFromProduct = (productId: string | null) => {
    if (priceTouched) return;
    const pp = productId ? snap.product_pricing.find((x) => x.product_id === productId) : undefined;
    setCalc(pp?.calc_method ?? (o.unit === '대' ? 'per_unit' : 'per_pallet'));
    setPrice(pp?.unit_price ?? null);
  };

  const chooseClient = async () => {
    const c = await pick.clientProduct(o.vehicle_id);
    if (!c) return;
    if (c.client_id !== o.client_id) setExtras([]);
    priceFromProduct(c.product?.id ?? null);
    set({
      client_id: c.client_id, client_text: c.client_text, product_id: c.product?.id ?? null, product_text: c.product_text,
      region: c.product?.default_region ?? o.region, quantity: c.product?.default_quantity ?? o.quantity, unit: c.product?.default_unit ?? o.unit,
      ...defaultPlaces(snap, c.client_id, c.product),
      ...(c.client_id && !o.departure_ship && isLoad ? { departure_ship: snap.clients.find((x) => x.id === c.client_id)?.default_ship ?? null } : {}),
    });
  };

  const addExtra = async () => {
    if (!o.client_id) return store.toast('먼저 등록된 거래처를 고르세요', 'warn');
    const c = await pick.clientProduct(o.vehicle_id, { id: o.client_id, text: o.client_text });
    if (!c || (!c.product && !c.product_text)) return;
    setExtras([...extras, { key: crypto.randomUUID?.() ?? String(Date.now()), product: c.product, product_text: c.product_text, quantity: c.product?.default_quantity ?? null, unit: c.product?.default_unit ?? '' }]);
  };
  const setExtra = (i: number, p: Partial<Extra>) => setExtras(extras.map((x, j) => (j === i ? { ...x, ...p } : x)));
  /** 추가 품목 → 같은 차량·기사·선박·비고로 오더 한 건씩 */
  const extraOrders = (): DailyOrder[] => extras.map((x, i) => ({
    ...o,
    id: newId(),
    product_id: x.product?.id ?? null,
    product_text: x.product_text,
    quantity: x.quantity,
    unit: x.unit,
    region: x.product?.default_region || o.region,
    ...defaultPlaces(snap, o.client_id, x.product),
    sort_order: o.sort_order + i + 1,
  }));

  const save = () => {
    if (!o.client_id && !o.client_text) return store.toast('거래처를 고르세요', 'warn');
    if (repeat) {
      if (!o.client_id) return store.toast('반복 발주는 등록된 거래처만 가능합니다', 'warn');
      if (o.date < seoulToday()) return store.toast('반복 시작일은 오늘 이후만 가능합니다', 'warn');
      let created = 0;
      for (const x of [o, ...extraOrders()]) {
        const res = planCreateRecurring(store.getState().snap, {
          client_id: o.client_id, product_id: x.product_id, zone: o.zone, kind: o.kind, startDate: o.date, today: seoulToday(),
          fields: {
            weekdays, quantity: x.quantity, unit: x.unit, region: x.region, memo: o.memo, vehicle_id: o.vehicle_id,
            ship: isLoad ? o.departure_ship : o.arrival_ship, ship_tag: isLoad ? o.departure_ship_tag : o.arrival_ship_tag,
          },
        });
        store.commit(res.mutations);
        created += res.created;
      }
      store.toast(`매주 반복 등록 · ${created}건 생성`);
    } else {
      const all = [o, ...extraOrders()];
      let split = 0;
      store.run((tx) => {
        for (const x of all) {
          createOrder(tx, x);
          // 직접 넣은 금액 (나누기 전에 넣어야 1대씩 나눌 때 금액도 1대분으로)
          if (x.id === o.id && staff && priceTouched) {
            const cur = tx.list('order_revenue').find((r) => r.order_id === x.id);
            saveRevenue(tx, {
              id: cur?.id ?? newId(), order_id: x.id, extras: cur?.extras ?? [], bill_to_client_id: cur?.bill_to_client_id ?? x.client_id, billing_status: cur?.billing_status ?? '미청구',
              calc_method: calc, unit_price: price, quantity: x.quantity, supply_amount: null, vat: null, total: null,
            });
          }
          const ids = splitPerVehicle(tx, x.id);
          split += ids.length - 1;
          // 첫 품목을 나눈 건마다 고른 차량 배정
          if (x.id === o.id && own && !repeat) ids.slice(1).forEach((id, i) => moreVehicles[i] && assignVehicle(tx, id, moreVehicles[i]));
        }
      });
      if (all.length > 1) store.toast(`${all.length}개 품목 저장`);
      if (split) store.toast(`대 단위는 1대씩 나눠 배차 대기로 ${split}건 더 만들었습니다`);
      store.toast(!isLoad ? '저장' : waitsForShip(o) ? '저장 · 선박 미정 → 내일 [[ 상차짐 ]]으로 이어짐' : `저장 · 반대 지역 하차도 ${o.same_day || o.arrival_offset === 0 ? '같은 날' : o.arrival_offset ? `${o.arrival_offset}일 뒤` : '다음 날'} 자동 입력${o.shipment === 'bulk' ? ' (벌크: 차량 없이 → 도착지에서 배차)' : ''}`);
    }
    nav(`/?date=${o.date}&zone=${o.zone}&focus=${o.id}`);
  };

  const Row = (p: { k: string; v: string; onClick: () => void; ph?: string }) => (
    <div className="editable card" style={{ margin: '6px 0' }} onClick={p.onClick}>
      <span className="k">{p.k}</span>
      <span className={`v${p.v ? '' : ' placeholder'}`}>{p.v || p.ph || '선택'}</span>
      <span className="muted">›</span>
    </div>
  );

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <h2>오더 입력</h2>
      <label className="field"><span>날짜</span><input type="date" value={o.date} onChange={(e) => { set({ date: e.target.value }); setWeekdays([weekdayOf(e.target.value)]); }} /></label>
      <label className="field"><span>구역</span>
        <Seg className="soft" value={o.zone} onChange={(z: Zone) => set({ zone: z })} options={[{ value: 'land', label: '육지' }, { value: 'jeju', label: '제주' }]} />
      </label>
      <label className="field"><span>구분</span>
        <Seg className="soft" value={o.kind} onChange={(k: Kind) => set({ kind: k })} options={[{ value: 'load', label: kindLabel(o.zone, 'load') }, { value: 'unload', label: kindLabel(o.zone, 'unload') }]} />
      </label>
      <label className="row night-toggle">
        <input type="checkbox" checked={!!o.night} onChange={(e) => set({ night: e.target.checked })} style={{ width: 24, height: 24 }} />
        <span><NightTag /> 작업 <span className="muted small">(오전·오후와 따로 야간 칸 · 야간 기사가 맡음)</span></span>
      </label>
      <Row k="거래처" v={clientName(snap, o)} onClick={chooseClient} ph="검색 · 최근 · 자주 쓰는" />
      <Row k="품목" v={productName(snap, o)} onClick={chooseClient} />
      <div className="field"><span className="muted small">수량{extras.length ? ` (${productName(snap, o) || '첫 품목'})` : ''} (숫자 뒤에 단위를 써도 됩니다: 10파렛트, 3대, 5박스)</span>
        <QtyInput quantity={o.quantity} unit={o.unit} onChange={(quantity, unit) => set({ quantity, unit })} />
      </div>
      {extras.map((x, i) => (
        <div key={x.key} className="card" style={{ margin: '6px 0' }}>
          <div className="row">
            <b className="grow">＋ {x.product?.name ?? x.product_text}</b>
            <button className="ghost" aria-label="추가 품목 삭제" onClick={() => setExtras(extras.filter((_, j) => j !== i))}>✕</button>
          </div>
          <QtyInput quantity={x.quantity} unit={x.unit} onChange={(quantity, unit) => setExtra(i, { quantity, unit })} />
        </div>
      ))}
      {staff && !repeat && (
        <div className="card quick-price">
          <div className="row" style={{ alignItems: 'center', gap: 6 }}>
            <b>💰 금액</b>
            <span className="muted small grow">{priceTouched ? '이 오더만 이 금액' : price != null ? '품목 기본 단가' : '비우면 금액 없이 저장'}</span>
          </div>
          <Seg className="soft" value={calc} onChange={(v: CalcMethod) => { setCalc(v); setPriceTouched(true); }} options={(Object.keys(CALC_LABEL) as CalcMethod[]).map((k) => ({ value: k, label: CALC_LABEL[k] }))} />
          <div className="row" style={{ alignItems: 'center', gap: 8, marginTop: 6 }}>
            <input inputMode="numeric" className="grow" placeholder={calc === 'fixed' ? '금액 (원)' : '단가 (원)'}
              value={price == null ? '' : price.toLocaleString('ko-KR')}
              onChange={(e) => { const d = e.target.value.replace(/[^\d]/g, ''); setPrice(d ? Number(d) : null); setPriceTouched(true); }} />
            {calc !== 'fixed' && <span className="muted small">× {o.quantity ?? 0}</span>}
          </div>
          {preview.total != null && <div className="small" style={{ marginTop: 4 }}>공급가 {won(preview.supply_amount)} + 부가세 {won(preview.vat)} = <b>{won(preview.total)}</b></div>}
        </div>
      )}
      {/* 간편 입력: 위까지만. 나머지는 "추가 내용"을 눌러 펼침 */}
      {!more && (
        <button className="more-btn" onClick={() => setMore(true)}>
          ＋ 추가 내용 <span className="muted small">같은 거래처 품목 · 지역 · 상차지/하차지 · 시간 · 운송 · 차량 · 기사 · 선박 · 비고 · 매주 반복</span>
        </button>
      )}
      {more && (<>
      {o.client_id && <button style={{ width: '100%', margin: '4px 0' }} onClick={addExtra}>＋ 같은 거래처 품목 추가</button>}
      <label className="field"><span>지역</span><input value={o.region} onChange={(e) => set({ region: e.target.value })} /></label>
      <PlaceFields pickup={o.pickup_place ?? ''} dropoff={o.dropoff_place ?? ''} onChange={(p) => set(p)} />
      <WorkFields kind={o.kind} time={o.work_time ?? ''} detail={o.work_detail ?? ''} onChange={(p) => set(p)} />
      <TransportFields o={o} set={set} />
      <p className="muted">차량·기사·선박은 나중에 지정해도 됩니다 (비우면 배차 대기)</p>
      {perVehicle > 0 && <div className="banner blue">{o.quantity}대 → {repeat ? '반복 날짜마다 ' : ''}오더 {o.quantity}건으로 나눠 저장합니다 (1대씩 따로 배차{repeat ? ', 2번째부터는 배차 대기' : ''})</div>}
      {own && <Row k={perVehicle ? '1번 차량' : '차량'} v={vehicleNo(snap, o.vehicle_id)} ph="나중에 배차" onClick={async () => { const v = await pick.vehicle(buildBoard(snap, o.date), o.zone); if (v) set({ vehicle_id: v }); }} />}
      {own && !repeat && perVehicle > 1 && Array.from({ length: perVehicle - 1 }, (_, i) => (
        <Row key={i} k={`${i + 2}번 차량`} v={vehicleNo(snap, moreVehicles[i] ?? null)} ph="나중에 배차" onClick={async () => {
          const v = await pick.vehicle(buildBoard(snap, o.date), o.zone);
          if (v) setMoreVehicles((cur) => { const next = [...cur]; next[i] = v; return next; });
        }} />
      ))}
      <Row k="기사" v={driverName(snap, o.driver_id)} ph="나중에" onClick={async () => { const d = await pick.driver(o.date, o.driver_id); if (d !== undefined) set({ driver_id: d }); }} />
      <Row
        k={isLoad ? departureShipLabel(o.zone) : arrivalShipLabel(o.zone)}
        v={isLoad ? shipText(o.departure_ship, o.departure_ship_tag) : shipText(o.arrival_ship, o.arrival_ship_tag)}
        ph="나중에"
        onClick={async () => {
          const r = await pick.ship(o.zone, isLoad ? { ship: o.departure_ship, tag: o.departure_ship_tag } : { ship: o.arrival_ship, tag: o.arrival_ship_tag }, isLoad ? 'departure' : 'arrival');
          if (r) set(isLoad ? { departure_ship: r.ship, departure_ship_tag: r.tag } : { arrival_ship: r.ship, arrival_ship_tag: r.tag });
        }}
      />
      <Row k="비고" v={o.memo} ph="야간 02시, 예약 …" onClick={async () => { const m = await pick.memo(o.memo); if (m !== null) set({ memo: m }); }} />
      <label className="card row" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} style={{ width: 28, minHeight: 28 }} />
        <span className="grow"><b>매주 반복으로 등록</b><br /><span className="muted">{fmtDate(o.date)}부터 앞으로 8주 자동 입력</span></span>
      </label>
      {repeat && <WeekdayChips value={weekdays} onChange={(v) => setWeekdays(v as Weekday[])} />}
      {isLoad && (waitsForShip(o)
        ? <div className="banner yellow">선박이 없거나 "대기"면 차량은 이 지역에 그대로 있고, 다음 날 일정에 <b>[[ 상차짐 ]]</b>으로 이어집니다. 선박을 정하면 그때 반대편 하차가 생깁니다.</div>
        : <div className="banner blue">상차를 저장하면 반대편 {o.zone === 'land' ? '제주 오전 하차' : '육지 하차'}에 자동으로 들어갑니다 (기사는 비워 둠{o.shipment === 'bulk' ? ', 벌크라 차량도 비워 둠' : ''}).</div>)}
      <button className="more-btn" onClick={() => setMore(false)}>▲ 추가 내용 접기</button>
      </>)}
      <div className="row order-save" style={{ marginTop: 16 }}>
        <button className="grow" onClick={() => nav(-1)}>취소</button>
        <button className="grow primary" onClick={save}>저장</button>
      </div>
    </div>
  );
}
