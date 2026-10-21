// 하루 일정표 화면 데이터: 등록 차량 전부 한 줄씩 + 배차 대기 + 현장근무
import { addDays, weekdayOf } from './dates.ts';
import { newId } from './ids.ts';
import { activeRepair, repairMemo, saveMaintenance } from './maintenance.ts';
import { ensureVehicleDay, opposite } from './orders.ts';
import { shipTimeOf } from './ships.ts';
import type { Tx } from './tx.ts';
import { ON_CALL_SHIFT } from './types.ts';
import type {
  DailyOrder, DayStatus, Driver, FieldAssignment, MaintenanceKind, ShipTag, Snapshot, Vehicle, VehicleDay, Zone,
} from './types.ts';

export const DAY_STATUS_LABEL: Record<Exclude<DayStatus, ''>, string> = {
  empty: '공차',
  repair: '수리',
  rest: '휴차',
  other: '기타',
};

const LOOKBACK_DAYS = 90;

export interface Index {
  ordersByDate: Map<string, DailyOrder[]>;
  vd: Map<string, VehicleDay>; // `${date}|${vehicle}`
  ordersByVehicleDate: Map<string, DailyOrder[]>;
}

export function buildIndex(snap: Snapshot): Index {
  const ordersByDate = new Map<string, DailyOrder[]>();
  const ordersByVehicleDate = new Map<string, DailyOrder[]>();
  for (const o of snap.daily_orders) {
    (ordersByDate.get(o.date) ?? ordersByDate.set(o.date, []).get(o.date)!).push(o);
    if (o.vehicle_id) {
      const k = `${o.date}|${o.vehicle_id}`;
      (ordersByVehicleDate.get(k) ?? ordersByVehicleDate.set(k, []).get(k)!).push(o);
    }
  }
  const vd = new Map(snap.vehicle_days.map((v) => [`${v.date}|${v.vehicle_id}`, v]));
  return { ordersByDate, vd, ordersByVehicleDate };
}

function explicitZone(idx: Index, vehicleId: string, date: string): Zone | null {
  const vd = idx.vd.get(`${date}|${vehicleId}`);
  if (vd?.zone) return vd.zone;
  const os = idx.ordersByVehicleDate.get(`${date}|${vehicleId}`);
  return os?.[0]?.zone ?? null;
}

/** 이 상차로 차량이 배를 타는지 */
export const vehicleSails = (o: DailyOrder) => o.kind === 'load' && !!o.departure_ship && !o.same_day && o.shipment !== 'bulk';

/** 용차·화주배차 오더 (직영 차량 배차 대상 아님) */
export const isExternal = (o: DailyOrder) => !!o.carrier_type && o.carrier_type !== 'own';

function departsOn(idx: Index, vehicleId: string, date: string): boolean {
  const vd = idx.vd.get(`${date}|${vehicleId}`);
  if (vd?.departure_ship) return true;
  // 당일 왕복 상차는 그날 밤 위치를 바꾸지 않는다
  // 당일 왕복 상차, 벌크(화물만 선적) 상차는 그날 밤 차량 위치를 바꾸지 않는다
  return (idx.ordersByVehicleDate.get(`${date}|${vehicleId}`) ?? []).some((o) => vehicleSails(o));
}

/**
 * 차량 위치 자동 결정: 그날 기록(줄의 구역·오더)이 있으면 그 구역,
 * 없으면 전날 위치에서 전날 출발 선박이 있으면 반대 구역으로. 기록이 하나도 없으면 등록 시 현재 위치.
 */
export function resolveVehicleZone(idx: Index, v: Vehicle, date: string): Zone | null {
  let anchor: { date: string; zone: Zone } | null = null;
  for (let i = 0; i <= LOOKBACK_DAYS; i++) {
    const d = addDays(date, -i);
    const z = explicitZone(idx, v.id, d);
    if (z) {
      anchor = { date: d, zone: z };
      break;
    }
  }
  if (!anchor) return v.home_zone;
  let zone = anchor.zone;
  for (let d = anchor.date; d < date; d = addDays(d, 1)) {
    if (departsOn(idx, v.id, d)) zone = opposite(zone);
  }
  return zone;
}

export interface BoardRow {
  vehicle: Vehicle;
  zone: Zone | null;
  vd: VehicleDay | undefined;
  unloads: DailyOrder[];
  loads: DailyOrder[];
  driverId: string | null;
  arrivalShip: string | null;
  arrivalTag: ShipTag;
  departureShip: string | null;
  departureTag: ShipTag;
  status: DayStatus | 'field';
  statusMemo: string;
  inRepair: boolean;
  shipPending: boolean;
  linkPending: boolean;
  /** 당일 왕복 등으로 그날 다른 구역에도 일이 있는 차량의 보조 줄 (선박은 오더에 직접 저장) */
  secondary: boolean;
}

export interface Board {
  date: string;
  rows: BoardRow[];
  land: BoardRow[];
  jeju: BoardRow[];
  waiting: { land: DailyOrder[]; jeju: DailyOrder[] };
  /** 용차·화주배차 오더 */
  external: { land: DailyOrder[]; jeju: DailyOrder[] };
  field: FieldAssignment[];
  fieldVehicleIds: Set<string>;
  unknownLocation: Vehicle[];
  summary: {
    land: number; jeju: number; empty: number; repair: number; field: number;
    waiting: number; external: number; unloads: number; loads: number; registered: number; noDriver: number;
  };
}

export function shipTime(snap: Snapshot, name: string | null): string {
  if (!name) return '99:99';
  return shipTimeOf(snap.ships, name) || '99:98';
}

export function buildBoard(snap: Snapshot, date: string, idx: Index = buildIndex(snap)): Board {
  const field = snap.field_assignments
    .filter((f) => f.date === date)
    .sort((a, b) => a.sort_order - b.sort_order);
  const fieldVehicleIds = new Set(field.filter((f) => f.vehicle_id && !f.is_off).map((f) => f.vehicle_id!));
  const dayOrders = idx.ordersByDate.get(date) ?? [];
  const rows: BoardRow[] = [];
  const unknownLocation: Vehicle[] = [];
  const vehicles = [...snap.vehicles].sort((a, b) => a.sort_order - b.sort_order || a.short_no.localeCompare(b.short_no));

  for (const v of vehicles) {
    const vd = idx.vd.get(`${date}|${v.id}`);
    const orders = (idx.ordersByVehicleDate.get(`${date}|${v.id}`) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    if (fieldVehicleIds.has(v.id) && orders.length === 0) continue; // 현장근무 지급 차량
    if (v.usage === '업무용' && orders.length === 0 && !vd) continue;
    const zone = resolveVehicleZone(idx, v, date);
    if (!zone) unknownLocation.push(v);
    // 당일 왕복 등으로 다른 구역에도 오더가 있으면 그 구역에 보조 줄을 하나 더 만든다
    const mine = zone ? orders.filter((o) => o.zone === zone) : orders;
    const elsewhere = zone ? orders.filter((o) => o.zone !== zone) : [];
    const unloads = mine.filter((o) => o.kind === 'unload');
    const loads = mine.filter((o) => o.kind === 'load');
    const repair = activeRepair(snap.maintenance_records, v.id, date);
    let status: BoardRow['status'] = vd?.status ?? '';
    let statusMemo = vd?.status_memo ?? '';
    if (repair) {
      status = 'repair';
      statusMemo = statusMemo || repairMemo(repair);
    } else if (!status && v.status === '정비') status = 'repair';
    else if (!status && v.status === '휴차') status = 'rest';
    if (!status && mine.length === 0) status = 'empty';
    const driverId = vd?.driver_id ?? orders.find((o) => o.driver_id)?.driver_id ?? null;
    rows.push({
      vehicle: v,
      zone,
      vd,
      unloads,
      loads,
      driverId,
      arrivalShip: vd?.arrival_ship ?? unloads.find((o) => o.arrival_ship)?.arrival_ship ?? null,
      arrivalTag: vd?.arrival_ship ? vd.arrival_ship_tag : unloads.find((o) => o.arrival_ship)?.arrival_ship_tag ?? '',
      departureShip: vd?.departure_ship ?? loads.find(vehicleSails)?.departure_ship ?? null,
      departureTag: vd?.departure_ship ? vd.departure_ship_tag : loads.find(vehicleSails)?.departure_ship_tag ?? '',
      status,
      statusMemo,
      inRepair: !!repair || v.status === '정비',
      shipPending: !!vd?.arrival_pending,
      linkPending: mine.some((o) => o.link_status === 'source_changed'),
      secondary: false,
    });
    if (elsewhere.length) {
      const u = elsewhere.filter((o) => o.kind === 'unload');
      const l = elsewhere.filter((o) => o.kind === 'load');
      const arr = u.find((o) => o.arrival_ship);
      const dep = l.find((o) => o.departure_ship);
      rows.push({
        vehicle: v,
        zone: opposite(zone!),
        vd: undefined,
        unloads: u,
        loads: l,
        driverId,
        arrivalShip: arr?.arrival_ship ?? null,
        arrivalTag: arr?.arrival_ship_tag ?? '',
        departureShip: dep?.departure_ship ?? null,
        departureTag: dep?.departure_ship_tag ?? '',
        status: '',
        statusMemo: '',
        inRepair: !!repair || v.status === '정비',
        shipPending: false,
        linkPending: elsewhere.some((o) => o.link_status === 'source_changed'),
        secondary: true,
      });
    }
  }

  const byShip = (a: DailyOrder, b: DailyOrder) =>
    shipTime(snap, a.departure_ship ?? a.arrival_ship).localeCompare(shipTime(snap, b.departure_ship ?? b.arrival_ship)) || a.sort_order - b.sort_order;
  const externalOf = (z: Zone) => dayOrders.filter((o) => o.zone === z && !o.vehicle_id && isExternal(o)).sort(byShip);
  const external = { land: externalOf('land'), jeju: externalOf('jeju') };
  // 배차 안 된 짐은 상차 예정 지역에만: 아직 차량 없는 상차에서 이어진 반대편 하차는 숨긴다
  // (상차에 차량을 배정하면 하차에도 차량이 채워져 그 차량 줄에 나타난다). 벌크는 도착지에서 다시 배차하므로 표시.
  const orderById = new Map(snap.daily_orders.map((o) => [o.id, o]));
  const waitsOnSource = (o: DailyOrder) => {
    if (o.kind !== 'unload' || !o.linked_from_id) return false;
    const src = orderById.get(o.linked_from_id);
    return !!src && !src.vehicle_id && !isExternal(src) && src.shipment !== 'bulk';
  };
  const waitingOf = (z: Zone) =>
    dayOrders
      .filter((o) => o.zone === z && !o.vehicle_id && !isExternal(o) && !waitsOnSource(o))
      .sort(byShip);
  const waiting = { land: waitingOf('land'), jeju: waitingOf('jeju') };
  const land = rows.filter((r) => r.zone === 'land');
  const jeju = rows.filter((r) => r.zone === 'jeju');
  const main = rows.filter((r) => !r.secondary);
  return {
    date,
    rows,
    land,
    jeju,
    waiting,
    external,
    field,
    fieldVehicleIds,
    unknownLocation,
    summary: {
      land: main.filter((r) => r.zone === 'land').length,
      jeju: main.filter((r) => r.zone === 'jeju').length,
      empty: main.filter((r) => r.status === 'empty').length,
      repair: main.filter((r) => r.status === 'repair').length,
      field: fieldVehicleIds.size,
      waiting: waiting.land.length + waiting.jeju.length,
      external: external.land.length + external.jeju.length,
      unloads: dayOrders.filter((o) => o.kind === 'unload').length,
      loads: dayOrders.filter((o) => o.kind === 'load').length,
      registered: snap.vehicles.filter((v) => v.usage === '배차').length,
      noDriver: main.filter((r) => (r.unloads.length || r.loads.length) && !r.driverId).length,
    },
  };
}

/** 기사 근무 여부: 근무 요일에 포함되고 그날 휴무자로 지정되지 않음 */
export function isDriverWorking(snap: Snapshot, d: Driver, date: string): boolean {
  if (snap.field_assignments.some((f) => f.date === date && f.staff_id === d.id && f.is_off)) return false;
  // 근무 기록(특근·알바 출근 등)이 있으면 근무일
  if ((snap.driver_work_logs ?? []).some((l) => l.date === date && l.driver_id === d.id)) return true;
  if (d.shift === ON_CALL_SHIFT) return false; // 알바: 출근 기록이 있는 날만
  return d.work_days.length === 0 || d.work_days.includes(weekdayOf(date));
}

export function offStaff(snap: Snapshot, date: string): Driver[] {
  return snap.drivers.filter((d) => !isDriverWorking(snap, d, date));
}

/** 배차 선택 목록용 차량: 그날 그 지역, 공차·상차 없는 차량 먼저, 현장근무 지급 차량 제외, 수리 차량은 경고 */
export function vehicleChoices(board: Board, zone: Zone | null) {
  return board.rows
    .filter((r) => !r.secondary && !board.fieldVehicleIds.has(r.vehicle.id))
    .map((r) => ({
      row: r,
      sameZone: zone === null || r.zone === zone,
      free: r.loads.length === 0,
      warn: r.inRepair ? '수리 중' : r.vehicle.status === '휴차' ? '휴차' : '',
    }))
    .sort((a, b) =>
      Number(b.sameZone) - Number(a.sameZone) ||
      Number(b.free) - Number(a.free) ||
      Number(!!a.warn) - Number(!!b.warn) ||
      a.row.vehicle.sort_order - b.row.vehicle.sort_order,
    );
}

/**
 * 공차·수리·휴차·기타 상태 입력. 수리를 고르고 정비 종류를 주면 정비 기록도 같이 만든다
 * (일정표 비고 〈차량 점검〉 과 정비 등록을 한 번 입력으로).
 */
export function setVehicleDayStatus(
  tx: Tx,
  p: {
    date: string; vehicle_id: string; zone: Zone | null; status: DayStatus; memo: string;
    maintenance?: { kind: MaintenanceKind; shop: string; end_date: string | null; staff_id?: string | null };
  },
) {
  const vd = ensureVehicleDay(tx, p.date, p.vehicle_id, p.zone);
  tx.update('vehicle_days', vd.id, { status: p.status, status_memo: p.memo });
  if (p.status === 'repair' && p.maintenance) {
    const existing = activeRepair(tx.list('maintenance_records'), p.vehicle_id, p.date);
    saveMaintenance(tx, {
      id: existing?.id ?? newId(),
      vehicle_id: p.vehicle_id,
      kind: p.maintenance.kind,
      shop: p.maintenance.shop,
      start_date: existing?.start_date ?? p.date,
      end_date: p.maintenance.end_date,
      odometer_km: existing?.odometer_km ?? null,
      cost: existing?.cost ?? null,
      staff_id: p.maintenance.staff_id ?? existing?.staff_id ?? null,
      memo: p.memo,
      photo_paths: existing?.photo_paths ?? [],
    });
  }
}

export function setRowDriver(tx: Tx, p: { date: string; vehicle_id: string; zone: Zone | null; driver_id: string | null }) {
  const vd = ensureVehicleDay(tx, p.date, p.vehicle_id, p.zone);
  tx.update('vehicle_days', vd.id, { driver_id: p.driver_id });
  for (const o of tx.list('daily_orders').filter((o) => o.date === p.date && o.vehicle_id === p.vehicle_id)) {
    tx.update('daily_orders', o.id, { driver_id: p.driver_id });
  }
}

/** 차량 위치 수동 변경 */
export function setVehicleZone(tx: Tx, p: { date: string; vehicle_id: string; zone: Zone }) {
  ensureVehicleDay(tx, p.date, p.vehicle_id, p.zone);
}

/** 일정표 차량 줄 순서 변경: vehicleId 를 targetId 자리로 옮긴다 (targetId = null 이면 맨 끝). 전체 순서를 다시 매긴다 */
export function moveVehicle(tx: Tx, vehicleId: string, targetId: string | null) {
  const list = [...tx.list('vehicles')].sort((a, b) => a.sort_order - b.sort_order || a.short_no.localeCompare(b.short_no));
  const from = list.findIndex((v) => v.id === vehicleId);
  if (from < 0) return;
  const [moved] = list.splice(from, 1);
  const to = targetId ? list.findIndex((v) => v.id === targetId) : list.length;
  list.splice(to < 0 ? list.length : to, 0, moved);
  list.forEach((v, i) => {
    if (v.sort_order !== i) tx.update('vehicles', v.id, { sort_order: i });
  });
}

/** 한 칸 위/아래로 (같은 구역 줄 기준이 아니라 전체 차량 순서 기준) */
export function nudgeVehicle(tx: Tx, vehicleId: string, dir: -1 | 1, visibleIds?: string[]) {
  const order = visibleIds ?? [...tx.list('vehicles')].sort((a, b) => a.sort_order - b.sort_order).map((v) => v.id);
  const i = order.indexOf(vehicleId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  // 화면에 보이는 이웃 차량 앞(위로) 또는 그 다음 차량 앞(아래로)으로 옮긴다
  moveVehicle(tx, vehicleId, dir < 0 ? order[j] : order[j + 1] ?? null);
}
