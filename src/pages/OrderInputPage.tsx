// 오더 입력: 구역 → 구분 → 거래처 → 품목·지역 자동 → 수량·단위 → 차량·기사·선박 → 비고 → 매주 반복
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  blankOrder, buildBoard, createOrder, planCreateRecurring, weekdayOf,
  type DailyOrder, type Kind, type Weekday, type Zone,
} from '../domain/index.ts';
import { store } from '../data/store.ts';
import { fmtDate, seoulToday } from '../lib/time.ts';
import { useSnap } from '../ui/hooks.ts';
import { arrivalShipLabel, clientName, departureShipLabel, driverName, kindLabel, productName, shipText, vehicleNo } from '../ui/labels.ts';
import { PlaceFields, TransportFields, defaultPlaces } from '../ui/OrderSheet.tsx';
import { QtyInput } from '../ui/QtyInput.tsx';
import { Seg, WeekdayChips } from '../ui/Picker.tsx';
import { usePickers } from '../ui/pickers.tsx';

export function OrderInputPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const snap = useSnap();
  const pick = usePickers();
  const [o, setO] = useState<DailyOrder>(() => blankOrder({
    date: params.get('date') ?? seoulToday(),
    zone: (params.get('zone') === 'jeju' ? 'jeju' : 'land') as Zone,
    kind: 'unload',
  }));
  const [repeat, setRepeat] = useState(false);
  const [weekdays, setWeekdays] = useState<Weekday[]>([weekdayOf(o.date)]);
  const set = (p: Partial<DailyOrder>) => setO({ ...o, ...p });
  const isLoad = o.kind === 'load';

  const chooseClient = async () => {
    const c = await pick.clientProduct(o.vehicle_id);
    if (!c) return;
    set({
      client_id: c.client_id, client_text: c.client_text, product_id: c.product?.id ?? null, product_text: c.product_text,
      region: c.product?.default_region ?? o.region, quantity: c.product?.default_quantity ?? o.quantity, unit: c.product?.default_unit ?? o.unit,
      ...defaultPlaces(snap, c.client_id, c.product),
      ...(c.client_id && !o.departure_ship && isLoad ? { departure_ship: snap.clients.find((x) => x.id === c.client_id)?.default_ship ?? null } : {}),
    });
  };

  const save = () => {
    if (!o.client_id && !o.client_text) return store.toast('거래처를 고르세요', 'warn');
    if (repeat) {
      if (!o.client_id) return store.toast('반복 발주는 등록된 거래처만 가능합니다', 'warn');
      if (o.date < seoulToday()) return store.toast('반복 시작일은 오늘 이후만 가능합니다', 'warn');
      const res = planCreateRecurring(snap, {
        client_id: o.client_id, product_id: o.product_id, zone: o.zone, kind: o.kind, startDate: o.date, today: seoulToday(),
        fields: {
          weekdays, quantity: o.quantity, unit: o.unit, region: o.region, memo: o.memo, vehicle_id: o.vehicle_id,
          ship: isLoad ? o.departure_ship : o.arrival_ship, ship_tag: isLoad ? o.departure_ship_tag : o.arrival_ship_tag,
        },
      });
      store.commit(res.mutations);
      store.toast(`매주 반복 등록 · ${res.created}건 생성`);
    } else {
      store.run((tx) => createOrder(tx, o));
      store.toast(!isLoad ? '저장' : `저장 · 반대 지역 하차도 ${o.same_day || o.arrival_offset === 0 ? '같은 날' : o.arrival_offset ? `${o.arrival_offset}일 뒤` : '다음 날'} 자동 입력${o.shipment === 'bulk' ? ' (벌크: 차량 없이 → 도착지에서 배차)' : ''}`);
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
        <Seg value={o.zone} onChange={(z: Zone) => set({ zone: z })} options={[{ value: 'land', label: '육지' }, { value: 'jeju', label: '제주' }]} />
      </label>
      <label className="field"><span>구분</span>
        <Seg value={o.kind} onChange={(k: Kind) => set({ kind: k })} options={[{ value: 'unload', label: kindLabel(o.zone, 'unload') }, { value: 'load', label: kindLabel(o.zone, 'load') }]} />
      </label>
      <Row k="거래처" v={clientName(snap, o)} onClick={chooseClient} ph="검색 · 최근 · 자주 쓰는" />
      <Row k="품목" v={productName(snap, o)} onClick={chooseClient} />
      <label className="field"><span>지역</span><input value={o.region} onChange={(e) => set({ region: e.target.value })} /></label>
      <PlaceFields pickup={o.pickup_place ?? ''} dropoff={o.dropoff_place ?? ''} onChange={(p) => set(p)} />
      <div className="field"><span className="muted small">수량 (숫자 뒤에 단위를 써도 됩니다: 10파렛트, 3대, 5박스)</span>
        <QtyInput quantity={o.quantity} unit={o.unit} onChange={(quantity, unit) => set({ quantity, unit })} />
      </div>
      <TransportFields o={o} set={set} />
      <p className="muted">차량·기사·선박은 나중에 지정해도 됩니다 (비우면 배차 대기)</p>
      {(o.carrier_type ?? 'own') === 'own' && <Row k="차량" v={vehicleNo(snap, o.vehicle_id)} ph="나중에 배차" onClick={async () => { const v = await pick.vehicle(buildBoard(snap, o.date), o.zone); if (v) set({ vehicle_id: v }); }} />}
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
      {isLoad && <div className="banner blue">상차를 저장하면 반대편 {o.zone === 'land' ? '제주 오전 하차' : '육지 하차'}에 자동으로 들어갑니다 (기사는 비워 둠{o.shipment === 'bulk' ? ', 벌크라 차량도 비워 둠' : ''}).</div>}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="grow" onClick={() => nav(-1)}>취소</button>
        <button className="grow primary" onClick={save}>저장</button>
      </div>
    </div>
  );
}
