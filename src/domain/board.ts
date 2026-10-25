// 하루 일정표 화면 데이터: 등록 차량 전부 한 줄씩 + 배차 대기 + 현장근무
import { addDays, weekdayOf } from './dates.ts';
import { newId } from './ids.ts';
import { activeRepair, repairMemo, saveMaintenance } from './maintenance.ts';
import { carriedLoads, ensureVehicleDay, heldLoads, opposite, waitsForShip } from './orders.ts';
import { departDelay, isWaitShip, shipTimeOf } from './ships.ts';
import type { Tx } from './tx.ts';
import { DEFAULT_START, ON_CALL_SHIFT } from './types.ts';
import type {
  DailyOrder, DayStatus, Driver, FieldAssignment, HelperRole, Kind, MaintenanceKind, RepairSpan, ShipTag, Snapshot, Vehicle, VehicleDay, Zone,
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
export const vehicleSails = (o: DailyOrder) => o.kind === 'load' && !!o.departure_ship && !isWaitShip(o.departure_ship) && !o.same_day && o.shipment !== 'bulk'
  && (!o.ship_date || o.ship_date === o.date); // 대기 후 나중 날 선적한 짐은 그 날 차량 줄의 선박으로 판단

/** 용차·화주배차 오더 (직영 차량 배차 대상 아님) */
export const isExternal = (o: DailyOrder) => !!o.carrier_type && o.carrier_type !== 'own';

/** 그날 차량이 배를 타는지: 안 타면 null, 타면 출발이 며칠 미뤄지는지 (익일선적 1) */
function departsOn(idx: Index, vehicleId: string, date: string): number | null {
  const vd = idx.vd.get(`${date}|${vehicleId}`);
  if (vd?.departure_ship && isWaitShip(vd.departure_ship)) return null; // 그날 차량 선박이 "대기"면 안 떠남
  if (vd?.departure_ship) return departDelay(vd.departure_ship);
  // 당일 왕복 상차, 벌크(화물만 선적) 상차는 그날 밤 차량 위치를 바꾸지 않는다
  const o = (idx.ordersByVehicleDate.get(`${date}|${vehicleId}`) ?? []).find((x) => vehicleSails(x));
  return o ? departDelay(o.departure_ship) : null;
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
  // 출발한 날 다음 날부터 반대 지역. 익일선적은 하루 더 이 지역에 있다가 넘어간다
  for (let d = anchor.date; d < date; d = addDays(d, 1)) {
    const delay = departsOn(idx, v.id, d);
    if (delay !== null && addDays(d, delay) < date) zone = opposite(zone);
  }
  return zone;
}

export interface BoardRow {
  vehicle: Vehicle;
  zone: Zone | null;
  vd: VehicleDay | undefined;
  unloads: DailyOrder[];
  loads: DailyOrder[];
  /** 전날까지 선박 "대기"로 싣고 있는 짐 → [[ 상차짐 ]] */
  carried: DailyOrder[];
  /** 오늘 하려다 다음 날로 미룬 하차 (오전 칸에 "하차 연기 →") */
  postponed: DailyOrder[];
  /** 고객 지정일까지 보관 중인 짐: 차량에 실은 채 대기 / 창고 보관 */
  held: { order: DailyOrder; hold: 'vehicle' | 'storage'; arrivedToday: boolean }[];
  /** 오전(하차) 기사 */
  driverId: string | null;
  /** 오후(상차) 기사 (따로 없으면 오전 기사) */
  loadDriverId: string | null;
  /** 기사의 그날 처리 순서 (없으면 null) */
  unloadSeq: number | null;
  loadSeq: number | null;
  /** 동승 기사 (선탑·지원) */
  helperId: string | null;
  helperRole: HelperRole | '';
  /** 야간 작업 (오전·오후와 따로) · 야간 기사 */
  nights: DailyOrder[];
  nightDriverId: string | null;
  /** 오전(하차)·오후(상차) 칸 비고 (오더 없이) */
  unloadNote: string;
  loadNote: string;
  /** 오전 기사 칸에 이름 대신: "오후도착" */
  amLabel: string;
  /** 출근 시간·장소 */
  startTime: string;
  startPlace: string;
  /** 따로 적지 않아 기본값(07:00 부두)으로 보이는 중 */
  startDefault: boolean;
  /** 그날 짧은 수리: 경미(운행 계속) / 오전만 / 오후만. 하루 이상 수리는 inRepair */
  shortRepair: Exclude<RepairSpan, 'full'> | null;
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

/** 차량은 배정됐는데 그 쪽(하차/상차) 기사가 없음 → "미배치" */
export const missingDriver = (r: Pick<BoardRow, 'unloads' | 'loads' | 'driverId' | 'loadDriverId'> & { amLabel?: string }, kind: Kind) =>
  kind === 'unload' ? r.unloads.length > 0 && !r.driverId && !r.amLabel : r.loads.length > 0 && !r.loadDriverId;
/** 야간 작업이 있는데 야간 기사가 없음 */
export const missingNightDriver = (r: Pick<BoardRow, 'nights' | 'nightDriverId'>) => r.nights.length > 0 && !r.nightDriverId;
export const needsDriver = (r: Pick<BoardRow, 'unloads' | 'loads' | 'driverId' | 'loadDriverId'> & { amLabel?: string; nights?: DailyOrder[]; nightDriverId?: string | null }) =>
  missingDriver(r, 'unload') || missingDriver(r, 'load') || (!!r.nights?.length && !r.nightDriverId);

export function shipTime(snap: Snapshot, name: string | null): string {
  if (!name) return '99:99';
  return shipTimeOf(snap.ships, name) || '99:98';
}

/** 상차 칸에 적은 비고는 그 짐을 내리는 하차 칸에도 같이 보인다 */
function fromLoadNotes(snap: Snapshot, idx: Index, unloads: DailyOrder[]): string[] {
  const notes = new Set<string>();
  for (const u of unloads) {
    const src = u.linked_from_id ? snap.daily_orders.find((o) => o.id === u.linked_from_id) : undefined;
    const note = src?.vehicle_id ? idx.vd.get(`${src.date}|${src.vehicle_id}`)?.load_note?.trim() : '';
    if (note) notes.add(note);
  }
  return [...notes];
}

export function buildBoard(snap: Snapshot, date: string, idx: Index = buildIndex(snap)): Board {
  const field = snap.field_assignments
    .filter((f) => f.date === date)
    .sort((a, b) => a.sort_order - b.sort_order);
  const fieldVehicleIds = new Set(field.filter((f) => f.vehicle_id && !f.is_off).map((f) => f.vehicle_id!));
  const dayOrders = idx.ordersByDate.get(date) ?? [];
  // 선박 "대기"로 싣고 있거나 나중 날 선적하는 상차 (다음 날 [[ 상차짐 ]] 표시용)
  const holds = heldLoads(snap, date);
  const waitingLoads = snap.daily_orders.filter((o) => o.kind === 'load' && o.vehicle_id && o.date < date && (o.ship_date ? o.ship_date >= date : waitsForShip(o)));
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
    const unloads = mine.filter((o) => o.kind === 'unload' && !o.night);
    const loads = mine.filter((o) => o.kind === 'load' && !o.night);
    const nights = mine.filter((o) => o.night);
    // 선박은 야간 작업까지 포함해서 (야간 상차 후 배를 타는 경우)
    const allUnloads = mine.filter((o) => o.kind === 'unload');
    const allLoads = mine.filter((o) => o.kind === 'load');
    const repair = activeRepair(snap.maintenance_records, v.id, date);
    let status: BoardRow['status'] = vd?.status ?? '';
    let statusMemo = vd?.status_memo ?? '';
    if (repair) {
      status = 'repair';
      statusMemo = statusMemo || repairMemo(repair);
    } else if (!status && v.status === '정비') status = 'repair';
    else if (!status && v.status === '휴차') status = 'rest';
    const carried = zone ? carriedLoads(waitingLoads, v.id, date, zone) : [];
    const postponed = snap.daily_orders.filter((o) => o.kind === 'unload' && o.vehicle_id === v.id && o.delayed_from === date && o.date > date);
    // 차량 대기는 매일, 창고 보관은 배가 닿은 날(입고)만 그 차량 줄에
    const held = holds.filter((h) => h.order.vehicle_id === v.id && (h.hold === 'vehicle' || h.arrive === date))
      .map((h) => ({ order: h.order, hold: h.hold as 'vehicle' | 'storage', arrivedToday: h.arrive === date }));
    if (!status && mine.length === 0 && carried.length === 0 && !vd?.night_driver_id && !postponed.length && !held.length && !vd?.unload_note && !vd?.load_note) status = 'empty';
    // 오후 기사만 정해 둔 날은 오전을 비워 둔다 (오더에 적힌 오후 기사를 오전으로 끌어오지 않음)
    const driverId = vd?.driver_id ?? (vd?.load_driver_id || vd?.am_label ? null : orders.find((o) => o.driver_id)?.driver_id ?? null);
    // 제주 기사는 따로 적지 않으면 기본 출근(07:00 부두)
    const startDefault = zone === 'jeju' && !!driverId && !vd?.start_time && !vd?.start_place && status !== 'rest' && status !== 'repair';
    rows.push({
      vehicle: v,
      zone,
      vd,
      unloads,
      loads,
      carried,
      postponed,
      held,
      nights,
      nightDriverId: vd?.night_driver_id ?? null,
      driverId,
      loadDriverId: vd?.load_driver_id || driverId,
      unloadSeq: vd?.unload_seq ?? null,
      loadSeq: vd?.load_seq ?? (vd?.load_driver_id ? null : vd?.unload_seq ?? null),
      helperId: vd?.helper_driver_id ?? null,
      helperRole: vd?.helper_role ?? '',
      unloadNote: [vd?.unload_note ?? '', ...fromLoadNotes(snap, idx, unloads)].filter(Boolean).join(' · '),
      loadNote: vd?.load_note ?? '',
      amLabel: vd?.am_label ?? '',
      startTime: startDefault ? DEFAULT_START.time : vd?.start_time ?? '',
      startPlace: startDefault ? DEFAULT_START.place : vd?.start_place ?? '',
      startDefault,
      shortRepair: shortRepairOn(snap, v.id, date),
      arrivalShip: vd?.arrival_ship ?? allUnloads.find((o) => o.arrival_ship)?.arrival_ship ?? null,
      arrivalTag: vd?.arrival_ship ? vd.arrival_ship_tag : allUnloads.find((o) => o.arrival_ship)?.arrival_ship_tag ?? '',
      departureShip: vd?.departure_ship ?? allLoads.find(vehicleSails)?.departure_ship ?? null,
      departureTag: vd?.departure_ship ? vd.departure_ship_tag : allLoads.find(vehicleSails)?.departure_ship_tag ?? '',
      status,
      statusMemo,
      inRepair: !!repair || v.status === '정비',
      shipPending: !!vd?.arrival_pending,
      linkPending: mine.some((o) => o.link_status === 'source_changed'),
      secondary: false,
    });
    if (elsewhere.length) {
      const u = elsewhere.filter((o) => o.kind === 'unload' && !o.night);
      const l = elsewhere.filter((o) => o.kind === 'load' && !o.night);
      const nt = elsewhere.filter((o) => o.night);
      const arr = [...u, ...nt].find((o) => o.kind === 'unload' && o.arrival_ship);
      const dep = [...l, ...nt].find((o) => o.kind === 'load' && o.departure_ship);
      rows.push({
        vehicle: v,
        zone: opposite(zone!),
        vd: undefined,
        unloads: u,
        loads: l,
        carried: [],
        postponed: [],
        held: [],
        nights: nt,
        nightDriverId: vd?.night_driver_id ?? null,
        driverId,
        loadDriverId: vd?.load_driver_id || driverId,
        unloadSeq: null,
        loadSeq: null,
        helperId: vd?.helper_driver_id ?? null,
        helperRole: vd?.helper_role ?? '',
        unloadNote: '',
        loadNote: '',
        amLabel: '',
        startTime: '',
        startPlace: '',
        startDefault: false,
        shortRepair: null,
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
      noDriver: main.filter(needsDriver).length,
    },
  };
}

/** 기사 근무 여부: 근무 요일에 포함되고 그날 휴무자로 지정되지 않음 */
export function isDriverWorking(snap: Snapshot, d: Driver, date: string): boolean {
  if (snap.field_assignments.some((f) => f.date === date && f.staff_id === d.id && f.is_off)) return false;
  // 근무 기록(특근·알바 출근 등)이 있으면 근무일
  const log = (snap.driver_work_logs ?? []).find((l) => l.date === date && l.driver_id === d.id);
  if (log) return log.day_status !== 'nonwork'; // 근무일 아님으로 지정한 날은 쉰다
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
/** 그날 짧은 수리 (경미·오전·오후) */
export function shortRepairOn(snap: Pick<Snapshot, 'maintenance_records'>, vehicleId: string, date: string): Exclude<RepairSpan, 'full'> | null {
  const r = snap.maintenance_records.find((m) => m.vehicle_id === vehicleId && m.start_date === date && (m.repair_span ?? 'full') !== 'full');
  return (r?.repair_span as Exclude<RepairSpan, 'full'> | undefined) ?? null;
}

export function setVehicleDayStatus(
  tx: Tx,
  p: {
    date: string; vehicle_id: string; zone: Zone | null; status: DayStatus; memo: string;
    maintenance?: { kind: MaintenanceKind; shop: string; end_date: string | null; staff_id?: string | null; span?: RepairSpan };
  },
) {
  const vd = ensureVehicleDay(tx, p.date, p.vehicle_id, p.zone);
  // 경미·반나절 수리: 그날 정비 기록만 남기고 차량은 하루 전체를 막지 않는다 (반나절은 그 반쪽에 수리 표시)
  const span = p.maintenance?.span ?? 'full';
  if (p.status === 'repair' && p.maintenance && span !== 'full') {
    if (vd.status === 'repair') tx.update('vehicle_days', vd.id, { status: '', status_memo: '' });
    const same = tx.list('maintenance_records').find((m) => m.vehicle_id === p.vehicle_id && m.start_date === p.date && (m.repair_span ?? 'full') !== 'full');
    saveMaintenance(tx, {
      id: same?.id ?? newId(), vehicle_id: p.vehicle_id, kind: p.maintenance.kind, shop: p.maintenance.shop,
      start_date: p.date, end_date: p.date, odometer_km: same?.odometer_km ?? null, cost: same?.cost ?? null,
      staff_id: p.maintenance.staff_id ?? same?.staff_id ?? null, memo: p.memo, photo_paths: same?.photo_paths ?? [], repair_span: span,
    });
    return;
  }
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

export type DriverSide = 'unload' | 'load';

/** 그 줄에서 오더 종류(하차/상차)를 맡는 기사 */
export const rowDriver = (row: Pick<BoardRow, 'driverId' | 'loadDriverId'>, kind: Kind) => (kind === 'load' ? row.loadDriverId : row.driverId);
/** 그 오더를 맡을 기사 (야간 작업은 야간 기사) */
export const orderDriver = (row: Pick<BoardRow, 'driverId' | 'loadDriverId' | 'nightDriverId'>, o: Pick<DailyOrder, 'kind' | 'night'>) =>
  (o.night ? row.nightDriverId : rowDriver(row, o.kind));

const seqField = (side: DriverSide) => (side === 'unload' ? 'unload_seq' : 'load_seq');

/** 그날 기사가 맡은 일(차량 × 오전/오후), 차량 순서대로. 오후 기사가 따로 없으면 오전·오후를 한 일로 본다 */
function driverJobs(tx: Tx, date: string, driverId: string): { vd: VehicleDay; side: DriverSide }[] {
  const order = new Map(tx.list('vehicles').map((v) => [v.id, v.sort_order]));
  const vds = tx.list('vehicle_days').filter((v) => v.date === date)
    .sort((a, b) => (order.get(a.vehicle_id) ?? 0) - (order.get(b.vehicle_id) ?? 0));
  const jobs: { vd: VehicleDay; side: DriverSide }[] = [];
  for (const vd of vds) {
    if (vd.driver_id === driverId) jobs.push({ vd, side: 'unload' });
    if (vd.load_driver_id && vd.load_driver_id !== vd.driver_id && vd.load_driver_id === driverId) jobs.push({ vd, side: 'load' });
  }
  return jobs;
}

/** 기사가 그날 두 번째 이상 일을 맡으면 순서를 매긴다: 번호 없는 앞 일부터 1, 2… 새 일은 맨 뒤 */
function numberJobs(tx: Tx, date: string, driverId: string, vdId: string, side: DriverSide) {
  const jobs = driverJobs(tx, date, driverId);
  if (jobs.length <= 1) {
    for (const j of jobs) tx.update('vehicle_days', j.vd.id, { [seqField(j.side)]: null });
    return;
  }
  const others = jobs.filter((j) => !(j.vd.id === vdId && j.side === side));
  let n = Math.max(0, ...others.map((j) => j.vd[seqField(j.side)] ?? 0));
  for (const j of others) if (j.vd[seqField(j.side)] == null) tx.update('vehicle_days', j.vd.id, { [seqField(j.side)]: ++n });
  tx.update('vehicle_days', vdId, { [seqField(side)]: n + 1 });
}

/** 기사가 빠진 뒤 일이 하나만 남으면 순서 표시를 지운다 */
function tidyJobs(tx: Tx, date: string, driverId: string) {
  const jobs = driverJobs(tx, date, driverId);
  if (jobs.length === 1) tx.update('vehicle_days', jobs[0].vd.id, { [seqField(jobs[0].side)]: null });
}

/**
 * 기사 지정. side='unload'(기본): 오전(하차) 기사 — 오후 기사가 따로 없으면 오후도 같은 기사.
 * side='load': 오후(상차) 기사 — 오전 기사와 같거나 비우면 "오전과 같음"으로 되돌린다.
 */
export function setRowDriver(tx: Tx, p: { date: string; vehicle_id: string; zone: Zone | null; driver_id: string | null; side?: DriverSide }) {
  const side = p.side ?? 'unload';
  const vd = ensureVehicleDay(tx, p.date, p.vehicle_id, p.zone);
  const d = p.driver_id;
  let old: string | null;
  if (side === 'unload') {
    old = vd.driver_id;
    const merged = !vd.load_driver_id || vd.load_driver_id === d;
    tx.update('vehicle_days', vd.id, { driver_id: d, unload_seq: null, ...(d ? { am_label: '' } : {}), ...(merged ? { load_driver_id: null, load_seq: null } : {}) });
  } else {
    old = vd.load_driver_id || null;
    const ld = d === vd.driver_id ? null : d;
    tx.update('vehicle_days', vd.id, { load_driver_id: ld, load_seq: null });
  }
  const now = tx.get('vehicle_days', vd.id)!;
  for (const o of tx.list('daily_orders').filter((o) => o.date === p.date && o.vehicle_id === p.vehicle_id && !o.night)) {
    const drv = o.kind === 'load' ? now.load_driver_id || now.driver_id : now.driver_id;
    if (o.driver_id !== drv) tx.update('daily_orders', o.id, { driver_id: drv });
  }
  if (side === 'unload' && d) numberJobs(tx, p.date, d, vd.id, 'unload');
  if (side === 'load' && now.load_driver_id) numberJobs(tx, p.date, now.load_driver_id, vd.id, 'load');
  if (old && old !== d) tidyJobs(tx, p.date, old);
}

/**
 * 오전(하차) 기사 칸에 "오후도착" 같은 말을 적는다 (빈 글자 = 지움). 오전 기사는 비우고,
 * 그 기사가 오전·오후를 같이 맡고 있었으면 오후 기사로 남긴다.
 */
export function setRowAmLabel(tx: Tx, p: { date: string; vehicle_id: string; zone: Zone | null; label: string }) {
  const vd = ensureVehicleDay(tx, p.date, p.vehicle_id, p.zone);
  const label = p.label.trim();
  if (!label) return void tx.update('vehicle_days', vd.id, { am_label: '' });
  const pm = vd.load_driver_id || vd.driver_id || null;
  tx.update('vehicle_days', vd.id, { am_label: label, driver_id: null, unload_seq: null, load_driver_id: pm, load_seq: vd.load_driver_id ? vd.load_seq : vd.unload_seq });
  for (const o of tx.list('daily_orders').filter((o) => o.date === p.date && o.vehicle_id === p.vehicle_id)) {
    const drv = o.kind === 'load' ? pm : null;
    if (o.driver_id !== drv) tx.update('daily_orders', o.id, { driver_id: drv });
  }
}

/** 야간 기사 지정 (null = 비우기). 그 차량 그날 야간 작업 오더의 기사도 같이 */
export function setRowNightDriver(tx: Tx, p: { date: string; vehicle_id: string; zone: Zone | null; driver_id: string | null }) {
  const vd = ensureVehicleDay(tx, p.date, p.vehicle_id, p.zone);
  tx.update('vehicle_days', vd.id, { night_driver_id: p.driver_id });
  for (const o of tx.list('daily_orders').filter((o) => o.date === p.date && o.vehicle_id === p.vehicle_id && o.night)) {
    if (o.driver_id !== p.driver_id) tx.update('daily_orders', o.id, { driver_id: p.driver_id });
  }
}

/** 동승 기사 (선탑·교육 / 지원) 지정. driver_id = null 이면 해제 */
export function setRowHelper(tx: Tx, p: { date: string; vehicle_id: string; zone: Zone | null; driver_id: string | null; role: HelperRole | '' }) {
  const vd = ensureVehicleDay(tx, p.date, p.vehicle_id, p.zone);
  tx.update('vehicle_days', vd.id, { helper_driver_id: p.driver_id, helper_role: p.driver_id ? p.role : '' });
}

/** 오전(하차)·오후(상차) 칸에 오더 없이 비고만 (빈 글자 = 지움) */
export function setRowNote(tx: Tx, p: { date: string; vehicle_id: string; zone: Zone | null; kind: Kind; note: string }) {
  const vd = ensureVehicleDay(tx, p.date, p.vehicle_id, p.zone);
  tx.update('vehicle_days', vd.id, p.kind === 'unload' ? { unload_note: p.note.trim() } : { load_note: p.note.trim() });
}

/** 출근 시간·장소 */
export function setRowStart(tx: Tx, p: { date: string; vehicle_id: string; zone: Zone | null; time: string; place: string }) {
  const vd = ensureVehicleDay(tx, p.date, p.vehicle_id, p.zone);
  // 기본값과 같으면 비워 둔다 (기본값으로 표시)
  const same = p.zone === 'jeju' && p.time === DEFAULT_START.time && p.place.trim() === DEFAULT_START.place;
  tx.update('vehicle_days', vd.id, same ? { start_time: '', start_place: '' } : { start_time: p.time, start_place: p.place.trim() });
}

/** 같은 차량의 가장 최근 출근 시간·장소 (새 날짜 입력 때 기본값) */
export function lastStart(snap: Pick<Snapshot, 'vehicle_days'>, vehicleId: string, before: string): { time: string; place: string } | null {
  const prev = snap.vehicle_days
    .filter((v) => v.vehicle_id === vehicleId && v.date < before && (v.start_time || v.start_place))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return prev ? { time: prev.start_time ?? '', place: prev.start_place ?? '' } : null;
}

/** "07:00 부두" */
export const startText = (r: Pick<BoardRow, 'startTime' | 'startPlace'>) => [r.startTime, r.startPlace].filter(Boolean).join(' ');

/** 처리 순서 직접 지정 (null = 표시 안 함) */
export function setDriverSeq(tx: Tx, p: { date: string; vehicle_id: string; zone: Zone | null; side: DriverSide; seq: number | null }) {
  const vd = ensureVehicleDay(tx, p.date, p.vehicle_id, p.zone);
  tx.update('vehicle_days', vd.id, { [seqField(p.side)]: p.seq });
}

/** ① ② ③ … */
export const seqMark = (n: number | null | undefined) => (n ? (n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`) : '');

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
