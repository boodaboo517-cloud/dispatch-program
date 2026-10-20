// 오더 저장·삭제와 "상차 → 다음 날 반대 지역 하차", "선박 자동 이어짐" 연결 로직.
import { addDays } from './dates.ts';
import { newId } from './ids.ts';
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
    ...p,
  };
}

export function blankVehicleDay(p: { date: string; vehicle_id: string } & Partial<VehicleDay>): VehicleDay {
  return {
    id: newId(),
    zone: null,
    driver_id: null,
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
  const s = snap.ships.find((x) => x.name === shipName);
  return s?.arrival_day_offset ?? 1;
}

/** 상차 → 연결 하차로 복사되는 값 (기사는 복사하지 않음) */
export function linkedValues(tx: Tx, load: DailyOrder): OrderSnapshot {
  return {
    vehicle_id: load.vehicle_id,
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
    date: addDays(load.date, arrivalOffset(tx.snap, load.departure_ship)),
  };
}

const SNAP_KEYS: (keyof OrderSnapshot)[] = [
  'vehicle_id', 'client_id', 'client_text', 'product_id', 'product_text', 'region',
  'quantity', 'unit', 'memo', 'arrival_ship', 'arrival_ship_tag', 'date',
];

function diffSnapshot(cur: DailyOrder, want: OrderSnapshot): Partial<OrderSnapshot> | null {
  const d: Partial<OrderSnapshot> = {};
  let any = false;
  for (const k of SNAP_KEYS) {
    if (cur[k] !== want[k]) {
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
  const want = linkedValues(tx, load);
  const cur = findLinkedUnload(tx, load.id);
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
  if (vd.departure_ship || vd.status || vd.status_memo || vd.driver_id) return true;
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
  if (!vd.departure_ship) {
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
  syncShipCarryover(tx, vd.id);
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
    const vd = ensureVehicleDay(tx, saved.date, saved.vehicle_id, saved.zone);
    // 상차 선박을 차량 줄 출발 선박으로 (비어 있을 때만)
    if (saved.kind === 'load' && saved.departure_ship && !vd.departure_ship) {
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
