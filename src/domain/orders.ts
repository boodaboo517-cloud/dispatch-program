// 오더 저장·삭제와 "상차 → 다음 날 반대 지역 하차", "선박 자동 이어짐" 연결 로직.
import { addDays, diffDays } from './dates.ts';
import { newId } from './ids.ts';
import { findShip, isNextDayShip, isWaitShip } from './ships.ts';
import { CARRIER_LABEL } from './types.ts';
import type { Tx } from './tx.ts';
import type {
  DailyOrder, OrderSnapshot, ShipTag, VehicleDay, Zone, Kind, Snapshot,
} from './types.ts';

export const opposite = (z: Zone): Zone => (z === 'land' ? 'jeju' : 'land');

export function blankOrder(p: { date: string; zone: Zone; kind: Kind } & Partial<DailyOrder>): DailyOrder {
  return {
    id: newId(),
    client_id: null,
    client_text: '',
    product_id: null,
    product_text: '',
    region: '',
    quantity: null,
    unit: '',
    memo: '',
    work_time: '',
    work_detail: '',
    vehicle_id: null,
    driver_id: null,
    arrival_ship: null,
    arrival_ship_tag: '',
    departure_ship: null,
    departure_ship_tag: '',
    sort_order: 0,
    source: 'manual',
    recurring_order_id: null,
    recurring_version_id: null,
    edited_manually: false,
    linked_from_id: null,
    link_status: 'none',
    link_pending: null,
    pickup_place: '',
    dropoff_place: '',
    same_day: false,
    carrier_type: 'own',
    carrier_name: '',
    carrier_vehicle: '',
    carrier_phone: '',
    shipment: 'vehicle',
    arrival_offset: null,
    ...p,
  };
}

export function blankVehicleDay(p: { date: string; vehicle_id: string } & Partial<VehicleDay>): VehicleDay {
  return {
    id: newId(),
    zone: null,
    driver_id: null,
    load_driver_id: null,
    unload_seq: null,
    load_seq: null,
    helper_driver_id: null,
    helper_role: '',
    start_time: '',
    start_place: '',
    unload_note: '',
    load_note: '',
    arrival_ship: null,
    arrival_ship_tag: '',
    departure_ship: null,
    departure_ship_tag: '',
    status: '',
    status_memo: '',
    arrival_from_id: null,
    arrival_edited_manually: false,
    arrival_pending: null,
    ...p,
  };
}

/** 선박 설정의 "도착일 차이" (기본 1일) */
export function arrivalOffset(snap: Pick<Snapshot, 'ships'>, shipName: string | null): number {
  if (!shipName) return 1;
  // 익일선적: 다음 날 배에 실어 그다음 날 도착
  if (isNextDayShip(shipName)) return 1 + (findShip(snap.ships, shipName.replace(/익일\s*선적/, '').trim())?.arrival_day_offset ?? 1);
  return findShip(snap.ships, shipName)?.arrival_day_offset ?? 1;
}

/** 상차 → 연결 하차로 복사되는 값 (기사는 복사하지 않음) */
/** 상차 → 연결 하차까지 날 수: 당일 왕복 0, 직접 정한 값, 없으면 선박 설정(기본 1) */
export function unloadDayOffset(snap: Pick<Snapshot, 'ships'>, load: DailyOrder): number {
  if (load.same_day) return 0;
  // 대기했다가 나중 날 선적한 짐: 상차일 → 선적일 날 수 + 선박 도착일 차이
  const waited = load.ship_date && load.ship_date > load.date ? diffDays(load.ship_date, load.date) : 0;
  if (load.arrival_offset != null) return waited + load.arrival_offset;
  return waited + arrivalOffset(snap, load.departure_ship);
}

export function linkedValues(tx: Tx, load: DailyOrder): OrderSnapshot {
  // 벌크는 화물만 배를 타므로 도착지에서 차량을 다시 섭외 → 차량·운송업체 비움
  const bulk = load.shipment === 'bulk';
  return {
    vehicle_id: bulk ? null : load.vehicle_id,
    carrier_type: bulk ? 'own' : load.carrier_type ?? 'own',
    carrier_name: bulk ? '' : load.carrier_name ?? '',
    carrier_vehicle: bulk ? '' : load.carrier_vehicle ?? '',
    carrier_phone: bulk ? '' : load.carrier_phone ?? '',
    client_id: load.client_id,
    client_text: load.client_text,
    product_id: load.product_id,
    product_text: load.product_text,
    region: load.region,
    quantity: load.quantity,
    unit: load.unit,
    memo: load.memo,
    arrival_ship: load.departure_ship,
    arrival_ship_tag: load.departure_ship_tag,
    date: addDays(load.date, unloadDayOffset(tx.snap, load)),
    pickup_place: load.pickup_place ?? '',
    dropoff_place: load.dropoff_place ?? '',
  };
}

const SNAP_KEYS: (keyof OrderSnapshot)[] = [
  'vehicle_id', 'client_id', 'client_text', 'product_id', 'product_text', 'region',
  'quantity', 'unit', 'memo', 'arrival_ship', 'arrival_ship_tag', 'date', 'pickup_place', 'dropoff_place',
  'carrier_type', 'carrier_name', 'carrier_vehicle', 'carrier_phone',
];

function diffSnapshot(cur: DailyOrder, want: OrderSnapshot): Partial<OrderSnapshot> | null {
  const d: Partial<OrderSnapshot> = {};
  let any = false;
  for (const k of SNAP_KEYS) {
    if ((cur[k] ?? (k === 'carrier_type' ? 'own' : '')) !== (want[k] ?? (k === 'carrier_type' ? 'own' : ''))) {
      (d as Record<string, unknown>)[k] = want[k];
      any = true;
    }
  }
  return any ? d : null;
}

export function findLinkedUnload(tx: Tx, loadId: string): DailyOrder | undefined {
  return tx.list('daily_orders').find((o) => o.linked_from_id === loadId);
}

/**
 * 상차를 저장한 뒤 호출: 다음 날(선박 도착일 차이) 반대 지역 하차를 만들거나 갱신한다.
 * 하차를 사람이 직접 고쳤다면 덮어쓰지 않고 link_pending 에 바뀐 값을 담아 "반영/무시" 를 묻는다.
 */
export function syncLinkedUnload(tx: Tx, loadId: string): DailyOrder | undefined {
  const load = tx.get('daily_orders', loadId);
  if (!load || load.kind !== 'load') return undefined;
  const cur = findLinkedUnload(tx, load.id);
  // 선박이 없거나 "대기"면 아직 배를 안 타므로 반대편 하차를 만들지 않는다 (자동으로 만든 것은 지움, 직접 고친 것은 둠)
  if (waitsForShip(load)) {
    if (cur && !cur.edited_manually) tx.remove('daily_orders', cur.id);
    return undefined;
  }
  const want = linkedValues(tx, load);
  if (!cur) {
    const siblings = tx.list('daily_orders').filter(
      (o) => o.date === want.date && o.zone === opposite(load.zone) && o.kind === 'unload',
    );
    return tx.insert('daily_orders', blankOrder({
      ...want,
      zone: opposite(load.zone),
      kind: 'unload',
      source: 'linked',
      linked_from_id: load.id,
      link_status: 'synced',
      driver_id: null,
      sort_order: siblings.length,
    }));
  }
  const diff = diffSnapshot(cur, want);
  if (!diff) {
    if (cur.link_pending) return tx.update('daily_orders', cur.id, { link_pending: null, link_status: 'synced' });
    return cur;
  }
  if (cur.edited_manually) {
    return tx.update('daily_orders', cur.id, { link_status: 'source_changed', link_pending: diff });
  }
  return tx.update('daily_orders', cur.id, { ...diff, link_status: 'synced', link_pending: null });
}

/** "반영" — 원본 상차의 바뀐 값을 직접 수정된 하차에 덮어쓴다 */
export function acceptLinkPending(tx: Tx, unloadId: string) {
  const u = tx.get('daily_orders', unloadId);
  if (!u?.link_pending) return;
  tx.update('daily_orders', u.id, { ...u.link_pending, link_pending: null, link_status: 'synced' });
}

/** "무시" — 하차는 그대로 두고 알림만 지운다 */
export function ignoreLinkPending(tx: Tx, unloadId: string) {
  const u = tx.get('daily_orders', unloadId);
  if (!u) return;
  tx.update('daily_orders', u.id, { link_pending: null, link_status: u.linked_from_id ? 'synced' : 'none' });
}

export function findVehicleDay(tx: Tx, date: string, vehicleId: string): VehicleDay | undefined {
  return tx.list('vehicle_days').find((v) => v.date === date && v.vehicle_id === vehicleId);
}

export function ensureVehicleDay(tx: Tx, date: string, vehicleId: string, zone: Zone | null): VehicleDay {
  const cur = findVehicleDay(tx, date, vehicleId);
  if (cur) {
    if (zone && cur.zone !== zone) return tx.update('vehicle_days', cur.id, { zone });
    return cur;
  }
  return tx.insert('vehicle_days', blankVehicleDay({ date, vehicle_id: vehicleId, zone }));
}

function vehicleDayHasContent(tx: Tx, vd: VehicleDay): boolean {
  if (vd.departure_ship || vd.status || vd.status_memo || vd.driver_id || vd.load_driver_id || vd.helper_driver_id || vd.start_time || vd.start_place || vd.unload_note || vd.load_note) return true;
  if (vd.arrival_ship && vd.arrival_from_id === null) return true;
  return tx.list('daily_orders').some((o) => o.date === vd.date && o.vehicle_id === vd.vehicle_id);
}

/**
 * 선박 자동 이어짐: 오늘 차량 줄의 출발(하행/오후) 선박 → 다음 날 반대 지역 같은 차량 줄의 도착 선박.
 * 짐이 없어도 선박만 있으면 다음 날 줄을 만든다.
 */
export function syncShipCarryover(tx: Tx, vehicleDayId: string) {
  const vd = tx.get('vehicle_days', vehicleDayId);
  const previous = tx.list('vehicle_days').filter((v) => v.arrival_from_id === vehicleDayId);
  if (!vd) {
    for (const p of previous) clearCarried(tx, p.id);
    return;
  }
  // 출발 선박이 없거나 "대기"면 다음 날로 넘어가지 않는다 (대기 = 그 지역에 그대로)
  if (!vd.departure_ship || isWaitShip(vd.departure_ship)) {
    for (const p of previous) clearCarried(tx, p.id);
    return;
  }
  const targetDate = addDays(vd.date, arrivalOffset(tx.snap, vd.departure_ship));
  const targetZone = vd.zone ? opposite(vd.zone) : null;
  // 도착일이 바뀐 경우 예전 날짜 쪽은 비운다
  for (const p of previous) if (p.date !== targetDate) clearCarried(tx, p.id);

  const target = findVehicleDay(tx, targetDate, vd.vehicle_id);
  const want = { ship: vd.departure_ship, tag: vd.departure_ship_tag };
  if (!target) {
    tx.insert('vehicle_days', blankVehicleDay({
      date: targetDate,
      vehicle_id: vd.vehicle_id,
      zone: targetZone,
      arrival_ship: want.ship,
      arrival_ship_tag: want.tag,
      arrival_from_id: vd.id,
    }));
    return;
  }
  if (target.arrival_ship === want.ship && target.arrival_ship_tag === want.tag) {
    tx.update('vehicle_days', target.id, { arrival_from_id: vd.id, arrival_pending: null });
    return;
  }
  if (target.arrival_edited_manually) {
    tx.update('vehicle_days', target.id, { arrival_from_id: vd.id, arrival_pending: want });
    return;
  }
  tx.update('vehicle_days', target.id, {
    arrival_ship: want.ship,
    arrival_ship_tag: want.tag,
    arrival_from_id: vd.id,
    arrival_pending: null,
    zone: target.zone ?? targetZone,
  });
}

/** 전날 선박이 지워졌을 때: 도착 선박 칸만 비우고, 줄에 다른 내용이 없으면 줄을 없앤다 */
function clearCarried(tx: Tx, targetId: string) {
  const t = tx.get('vehicle_days', targetId);
  if (!t) return;
  if (t.arrival_edited_manually) {
    tx.update('vehicle_days', t.id, { arrival_pending: { ship: null, tag: '' }, arrival_from_id: null });
    return;
  }
  const cleared = tx.update('vehicle_days', t.id, {
    arrival_ship: null, arrival_ship_tag: '', arrival_from_id: null, arrival_pending: null,
  });
  if (!vehicleDayHasContent(tx, cleared)) tx.remove('vehicle_days', t.id);
}

export function acceptShipPending(tx: Tx, vehicleDayId: string) {
  const t = tx.get('vehicle_days', vehicleDayId);
  if (!t?.arrival_pending) return;
  tx.update('vehicle_days', t.id, {
    arrival_ship: t.arrival_pending.ship,
    arrival_ship_tag: t.arrival_pending.tag,
    arrival_pending: null,
    arrival_edited_manually: false,
  });
}

export function ignoreShipPending(tx: Tx, vehicleDayId: string) {
  const t = tx.get('vehicle_days', vehicleDayId);
  if (t) tx.update('vehicle_days', t.id, { arrival_pending: null });
}

/**
 * 차량 줄의 선박 칸 수정 (사람이 직접 입력).
 * 출발 선박이면 그 차량의 상차에도 같이 넣고 → 연결 하차·다음 날 도착 선박까지 이어서 갱신한다.
 */
export function setRowShip(
  tx: Tx,
  p: { date: string; vehicle_id: string; zone: Zone; which: 'arrival' | 'departure'; ship: string | null; tag: ShipTag },
) {
  const vd = ensureVehicleDay(tx, p.date, p.vehicle_id, p.zone);
  if (p.which === 'arrival') {
    tx.update('vehicle_days', vd.id, {
      arrival_ship: p.ship,
      arrival_ship_tag: p.tag,
      arrival_edited_manually: vd.arrival_from_id !== null,
      arrival_pending: null,
    });
    for (const o of rowOrders(tx, p.date, p.vehicle_id, 'unload')) {
      tx.update('daily_orders', o.id, { arrival_ship: p.ship, arrival_ship_tag: p.tag, edited_manually: o.linked_from_id ? true : o.edited_manually });
    }
    return;
  }
  tx.update('vehicle_days', vd.id, { departure_ship: p.ship, departure_ship_tag: p.tag });
  for (const o of rowOrders(tx, p.date, p.vehicle_id, 'load')) {
    tx.update('daily_orders', o.id, { departure_ship: p.ship, departure_ship_tag: p.tag });
    syncLinkedUnload(tx, o.id);
  }
  // 전날까지 "대기"로 싣고 있던 짐 [[ 상차짐 ]]: 이 날 선박을 정하면 이 날 선적 (또 대기면 다음 날로 계속)
  for (const o of carriedLoads(tx.list('daily_orders'), p.vehicle_id, p.date, p.zone)) {
    const sails = !!p.ship && !isWaitShip(p.ship);
    tx.update('daily_orders', o.id, { departure_ship: sails ? p.ship : '대기', departure_ship_tag: p.tag, ship_date: sails ? p.date : null });
    syncLinkedUnload(tx, o.id);
  }
  syncShipCarryover(tx, vd.id);
}

/** 상차했는데 선박이 아직 없거나 "대기" (당일 왕복·벌크 제외): 차량은 그 지역에 그대로, 반대편 하차는 선박을 정할 때 */
export const waitsForShip = (o: Pick<DailyOrder, 'kind' | 'same_day' | 'shipment' | 'ship_date' | 'departure_ship'>) =>
  o.kind === 'load' && !o.same_day && o.shipment !== 'bulk' && !o.ship_date && (!o.departure_ship || isWaitShip(o.departure_ship));

/** 그날 이 차량에 실려 있는 "대기" 짐: 이전 날 같은 지역에서 상차했고, 아직 배를 안 탔거나 이 날 선적하는 것 (최대 14일) */
export function carriedLoads(orders: DailyOrder[], vehicleId: string, date: string, zone: Zone | null): DailyOrder[] {
  return orders.filter((o) => o.kind === 'load' && o.vehicle_id === vehicleId && o.date < date && diffDays(date, o.date) <= 14
    && (!zone || o.zone === zone)
    && (o.ship_date ? o.ship_date >= date : waitsForShip(o)));
}

function rowOrders(tx: Tx, date: string, vehicleId: string, kind: Kind) {
  return tx.list('daily_orders').filter((o) => o.date === date && o.vehicle_id === vehicleId && o.kind === kind);
}

/**
 * 오더 저장 (신규·수정 공통). userEdit=true 면 사람이 고친 것으로 표시해
 * 반복 발주 변경·원본 상차 변경 때 덮어쓰지 않는다.
 */
export function saveOrder(tx: Tx, order: DailyOrder, opts: { userEdit?: boolean } = {}): DailyOrder {
  const existing = tx.get('daily_orders', order.id);
  const isEdit = !!existing && opts.userEdit !== false;
  const row: DailyOrder = {
    ...order,
    edited_manually: order.edited_manually || (isEdit && order.source !== 'manual'),
  };
  const saved = existing
    ? tx.update('daily_orders', row.id, row)
    : tx.insert('daily_orders', row);

  if (saved.vehicle_id) {
    const vd = placeVehicleDay(tx, saved);
    // 상차 선박을 차량 줄 출발 선박으로 (비어 있을 때만). 당일 왕복 상차는 그날 밤 위치를 바꾸지 않으므로 제외
    // 벌크는 차량이 배를 타지 않으므로 차량 줄 선박·위치에 영향 없음
    if (vd && saved.kind === 'load' && saved.departure_ship && !vd.departure_ship && !saved.same_day && saved.shipment !== 'bulk') {
      tx.update('vehicle_days', vd.id, { departure_ship: saved.departure_ship, departure_ship_tag: saved.departure_ship_tag });
      syncShipCarryover(tx, vd.id);
    }
  }
  // 차량이 바뀌어 예전 차량 줄의 출발 선박이 고아가 되면 정리
  if (existing && existing.vehicle_id && (existing.vehicle_id !== saved.vehicle_id || existing.date !== saved.date)) {
    releaseDepartureShip(tx, existing);
  }
  if (saved.kind === 'load') syncLinkedUnload(tx, saved.id);
  return tx.get('daily_orders', saved.id)!;
}

/** 당일 왕복 오더인지 (상차 자체가 당일 왕복이거나, 당일 왕복 상차에서 이어진 같은 날 하차) */
function isSameDayTrip(tx: Tx, o: DailyOrder): boolean {
  if (o.same_day) return true;
  const src = o.linked_from_id ? tx.get('daily_orders', o.linked_from_id) : undefined;
  return !!src?.same_day && src.date === o.date;
}

/**
 * 오더를 저장할 때 차량의 그날 줄(vehicle_days) 구역을 정한다.
 * - 줄이 없으면 오더 구역으로 만든다.
 * - 당일 왕복 오더이거나, 줄 구역에 이미 다른 오더가 있으면 줄 구역은 그대로 둔다 (다른 구역은 보조 줄로 표시).
 * - 그 밖에는 차량을 오더 구역으로 옮긴다.
 */
function placeVehicleDay(tx: Tx, o: DailyOrder): VehicleDay | undefined {
  const cur = findVehicleDay(tx, o.date, o.vehicle_id!);
  if (isSameDayTrip(tx, o)) {
    // 당일 왕복: 차량은 출발한 쪽(상차 반대편)에서 하루를 시작하고 끝낸다
    const home = o.kind === 'load' ? opposite(o.zone) : o.zone;
    if (!cur || !cur.zone) return ensureVehicleDay(tx, o.date, o.vehicle_id!, home);
    return cur.zone === o.zone ? cur : undefined;
  }
  if (!cur || !cur.zone) return ensureVehicleDay(tx, o.date, o.vehicle_id!, o.zone);
  if (cur.zone === o.zone) return cur;
  const others = tx.list('daily_orders').some((x) => x.id !== o.id && x.date === o.date && x.vehicle_id === o.vehicle_id && x.zone === cur.zone);
  if (others) return undefined;
  return ensureVehicleDay(tx, o.date, o.vehicle_id!, o.zone);
}

function releaseDepartureShip(tx: Tx, old: DailyOrder) {
  if (old.kind !== 'load' || !old.vehicle_id) return;
  const remaining = rowOrders(tx, old.date, old.vehicle_id, 'load').filter((o) => o.id !== old.id);
  const vd = findVehicleDay(tx, old.date, old.vehicle_id);
  if (vd && remaining.length === 0 && vd.departure_ship === old.departure_ship) {
    tx.update('vehicle_days', vd.id, { departure_ship: null, departure_ship_tag: '' });
    syncShipCarryover(tx, vd.id);
    const after = tx.get('vehicle_days', vd.id)!;
    if (!vehicleDayHasContent(tx, after) && !after.arrival_ship) tx.remove('vehicle_days', vd.id);
  }
}

export type LinkedDeleteChoice = 'delete' | 'keep';

/**
 * 오더 삭제. 상차에 연결된 하차가 있으면 linkedChoice 로 함께 지울지 결정한다
 * (화면에서 먼저 물어본다).
 */
export function deleteOrder(tx: Tx, orderId: string, linkedChoice: LinkedDeleteChoice = 'delete') {
  const o = tx.get('daily_orders', orderId);
  if (!o) return;
  const linked = o.kind === 'load' ? findLinkedUnload(tx, o.id) : undefined;
  tx.remove('daily_orders', o.id);
  for (const r of tx.list('order_revenue').filter((r) => r.order_id === o.id)) tx.remove('order_revenue', r.id);
  releaseDepartureShip(tx, o);
  if (linked) {
    if (linkedChoice === 'delete') deleteOrder(tx, linked.id);
    else tx.update('daily_orders', linked.id, { linked_from_id: null, link_status: 'source_deleted', link_pending: null });
  }
}

/** 배차 대기 상차에 차량 배정 → 하차 쪽 차량번호도 함께 채운다 (saveOrder → syncLinkedUnload) */
export function assignVehicle(tx: Tx, orderId: string, vehicleId: string | null, driverId?: string | null) {
  const o = tx.get('daily_orders', orderId);
  if (!o) return;
  saveOrder(tx, { ...o, vehicle_id: vehicleId, driver_id: driverId ?? o.driver_id });
}

/** 운송 방법 요약 (보기 화면·엑셀) */
export function transportSummary(s: Pick<Snapshot, 'ships'>, o: DailyOrder): string {
  const parts: string[] = [];
  const ct = o.carrier_type ?? 'own';
  if (ct !== 'own') parts.push([CARRIER_LABEL[ct], o.carrier_name, o.carrier_vehicle, o.carrier_phone].filter(Boolean).join(' '));
  if (o.kind === 'load') {
    if (o.shipment === 'bulk') parts.push('벌크(화물만 선적)');
    if (o.same_day) parts.push('당일 왕복');
    else if (o.arrival_offset != null) parts.push(`하차 ${o.arrival_offset === 0 ? '같은 날' : `${o.arrival_offset}일 뒤`}`);
    else if (unloadDayOffset(s, o) !== 1) parts.push(`하차 ${unloadDayOffset(s, o)}일 뒤`);
  }
  return parts.join(' · ');
}


/** 상·하차 세부 한 줄: "08:40 하차 · 막걸리공병 하차지원" */
export function workText(o: Pick<DailyOrder, 'kind' | 'work_time' | 'work_detail'>): string {
  return [o.work_time ? `${o.work_time} ${o.kind === 'load' ? '상차' : '하차'}` : '', o.work_detail?.trim() ?? ''].filter(Boolean).join(' · ');
}

/**
 * 선박 "대기"·"익일선적"·나중 선적 규칙이 생기기 전에 저장된 짐 바로잡기 (앱 열 때 한 번).
 * 연결 하차를 다시 맞춰서(대기면 자동 하차 지움, 익일선적이면 날짜 +2) 차량이 엉뚱한 지역에 나오지 않게 한다.
 */
export function repairShipLinks(tx: Tx, fromDate: string) {
  for (const o of tx.list('daily_orders')) {
    if (o.kind !== 'load' || o.date < fromDate) continue;
    if (waitsForShip(o) || isNextDayShip(o.departure_ship) || o.ship_date) syncLinkedUnload(tx, o.id);
  }
  for (const vd of tx.list('vehicle_days')) {
    if (vd.date < fromDate) continue;
    if (isWaitShip(vd.departure_ship) || isNextDayShip(vd.departure_ship)) syncShipCarryover(tx, vd.id);
  }
}
