// 하루 일정표 화면 데이터: 등록 차량 전부 한 줄씩 + 배차 대기 + 현장근무
import { addDays, weekdayOf } from './dates.ts';
import { newId } from './ids.ts';
import { activeRepair, repairMemo, saveMaintenance } from './maintenance.ts';
import { ensureVehicleDay, opposite } from './orders.ts';
import type { Tx } from './tx.ts';
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

function departsOn(idx: Index, vehicleId: string, date: string): boolean {
  const vd = idx.vd.get(`${date}|${vehicleId}`);
  if (vd?.departure_ship) return true;
  return (idx.ordersByVehicleDate.get(`${date}|${vehicleId}`) ?? []).some((o) => o.kind === 'load' && !!o.departure_ship);
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
}

export interface Board {
  date: string;
  rows: BoardRow[];
  land: BoardRow[];
  jeju: BoardRow[];
  waiting: { land: DailyOrder[]; jeju: DailyOrder[] };
  field: FieldAssignment[];
  fieldVehicleIds: Set<string>;
  unknownLocation: Vehicle[];
  summary: {
    land: number; jeju: number; empty: number; repair: number; field: number;
    waiting: number; unloads: number; loads: number; registered: number; noDriver: number;
  };
}

export function shipTime(snap: Snapshot, name: string | null): string {
  if (!name) return '99:99';
  return snap.ships.find((s) => s.name === name)?.departs_at ?? '99:98';
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
    const unloads = orders.filter((o) => o.kind === 'unload');
    const loads = orders.filter((o) => o.kind === 'load');
    const repair = activeRepair(snap.maintenance_records, v.id, date);
    let status: BoardRow['status'] = vd?.status ?? '';
    let statusMemo = vd?.status_memo ?? '';
    if (repair) {
      status = 'repair';
      statusMemo = statusMemo || repairMemo(repair);
    } else if (!status && v.status === '정비') status = 'repair';
    else if (!status && v.status === '휴차') status = 'rest';
    if (!status && orders.length === 0) status = 'empty';
    rows.push({
      vehicle: v,
      zone,
      vd,
      unloads,
      loads,
      driverId: vd?.driver_id ?? orders.find((o) => o.driver_id)?.driver_id ?? null,
      arrivalShip: vd?.arrival_ship ?? unloads.find((o) => o.arrival_ship)?.arrival_ship ?? null,
      arrivalTag: vd?.arrival_ship ? vd.arrival_ship_tag : unloads.find((o) => o.arrival_ship)?.arrival_ship_tag ?? '',
      departureShip: vd?.departure_ship ?? loads.find((o) => o.departure_ship)?.departure_ship ?? null,
      departureTag: vd?.departure_ship ? vd.departure_ship_tag : loads.find((o) => o.departure_ship)?.departure_ship_tag ?? '',
      status,
      statusMemo,
      inRepair: !!repair || v.status === '정비',
      shipPending: !!vd?.arrival_pending,
      linkPending: orders.some((o) => o.link_status === 'source_changed'),
    });
  }

  const waitingOf = (z: Zone) =>
    dayOrders
      .filter((o) => o.zone === z && !o.vehicle_id)
      .sort((a, b) =>
        shipTime(snap, a.departure_ship ?? a.arrival_ship).localeCompare(shipTime(snap, b.departure_ship ?? b.arrival_ship)) ||
        a.sort_order - b.sort_order,
      );
  const waiting = { land: waitingOf('land'), jeju: waitingOf('jeju') };
  const land = rows.filter((r) => r.zone === 'land');
  const jeju = rows.filter((r) => r.zone === 'jeju');
  return {
    date,
    rows,
    land,
    jeju,
    waiting,
    field,
    fieldVehicleIds,
    unknownLocation,
    summary: {
      land: land.length,
      jeju: jeju.length,
      empty: rows.filter((r) => r.status === 'empty').length,
      repair: rows.filter((r) => r.status === 'repair').length,
      field: fieldVehicleIds.size,
      waiting: waiting.land.length + waiting.jeju.length,
      unloads: dayOrders.filter((o) => o.kind === 'unload').length,
      loads: dayOrders.filter((o) => o.kind === 'load').length,
      registered: snap.vehicles.filter((v) => v.usage === '배차').length,
      noDriver: rows.filter((r) => (r.unloads.length || r.loads.length) && !r.driverId).length,
    },
  };
}

/** 기사 근무 여부: 근무 요일에 포함되고 그날 휴무자로 지정되지 않음 */
export function isDriverWorking(snap: Snapshot, d: Driver, date: string): boolean {
  if (snap.field_assignments.some((f) => f.date === date && f.staff_id === d.id && f.is_off)) return false;
  return d.work_days.length === 0 || d.work_days.includes(weekdayOf(date));
}

export function offStaff(snap: Snapshot, date: string): Driver[] {
  return snap.drivers.filter((d) => !isDriverWorking(snap, d, date));
}

/** 배차 선택 목록용 차량: 그날 그 지역, 공차·상차 없는 차량 먼저, 현장근무 지급 차량 제외, 수리 차량은 경고 */
export function vehicleChoices(board: Board, zone: Zone | null) {
  return board.rows
    .filter((r) => !board.fieldVehicleIds.has(r.vehicle.id))
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
