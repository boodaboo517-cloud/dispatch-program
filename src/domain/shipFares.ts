// 선박 운임: 선박(·차종)별 기본 / 공차 / 할증 요금 + 기사 승선 금액. 배편마다 짐 유무로 기본·공차 자동, 할증은 직접
import { buildBoard, buildIndex, type BoardRow } from './board.ts';
import { eachDay } from './dates.ts';
import { newId } from './ids.ts';
import { ensureVehicleDay } from './orders.ts';
import { isWaitShip, parseShip } from './ships.ts';
import type { Tx } from './tx.ts';
import type { CalcMethod, DailyOrder, FareKind, ShipFare, Snapshot, Zone } from './types.ts';

/** 그 선박·차종에 맞는 요금 (차종 요금이 있으면 차종, 없으면 기본 줄) */
export function fareFor(snap: Pick<Snapshot, 'ships' | 'ship_fares'>, shipValue: string | null, vehicleType: string): { ship: string; fare: ShipFare | undefined; general: ShipFare | undefined } {
  const name = parseShip(shipValue).name;
  const ship = snap.ships.find((s) => s.name === name);
  const rows = ship ? (snap.ship_fares ?? []).filter((f) => f.ship_id === ship.id) : [];
  const general = rows.find((f) => !f.vehicle_type);
  return { ship: name, fare: rows.find((f) => f.vehicle_type === vehicleType) ?? general, general };
}

/** 요금 한 줄 저장 (같은 선박·차종 줄이 있으면 고침) */
export function setShipFare(tx: Tx, p: Omit<ShipFare, 'id'>) {
  const cur = tx.list('ship_fares').find((f) => f.ship_id === p.ship_id && f.vehicle_type === p.vehicle_type);
  if (cur) tx.update('ship_fares', cur.id, p);
  else tx.insert('ship_fares', { id: newId(), ...p });
}

export function removeShipFare(tx: Tx, shipId: string, vehicleType: string) {
  for (const f of tx.list('ship_fares').filter((x) => x.ship_id === shipId && x.vehicle_type === vehicleType)) tx.remove('ship_fares', f.id);
}

/** 배편 요금 구분 · 기사 승선 */
export function setVoyage(tx: Tx, p: { date: string; vehicle_id: string; zone: Zone | null; fare_kind: FareKind; boarding: boolean }) {
  const vd = ensureVehicleDay(tx, p.date, p.vehicle_id, p.zone);
  tx.update('vehicle_days', vd.id, { fare_kind: p.fare_kind, boarding: p.boarding });
}

export interface Voyage {
  date: string;
  row: BoardRow;
  ship: string;
  kind: Exclude<FareKind, ''>;
  /** 요금 구분을 직접 정했는지 (아니면 짐 유무로 자동) */
  manual: boolean;
  fare: number | null;
  boarding: number | null;
  total: number;
  /** 요금이 등록 안 돼 계산 못 한 부분 */
  missing: string[];
}

/** 그 줄이 실제로 배를 타는지 (출발 선박이 있고 "대기"가 아님) */
export const sails = (r: BoardRow) => !!r.departureShip && !isWaitShip(r.departureShip);

export function voyageOf(snap: Pick<Snapshot, 'ships' | 'ship_fares'>, date: string, r: BoardRow): Voyage {
  const loaded = r.loads.length + r.carried.length > 0;
  const manual = !!r.vd?.fare_kind;
  const kind = (r.vd?.fare_kind || (loaded ? 'base' : 'empty')) as Exclude<FareKind, ''>;
  const { ship, fare, general } = fareFor(snap, r.departureShip, r.vehicle.vehicle_type);
  const missing: string[] = [];
  const amount = fare?.[kind] ?? null;
  if (amount == null) missing.push(fare ? `${ship} ${kind === 'base' ? '기본' : kind === 'empty' ? '공차' : '할증'} 요금` : `${ship || '선박'} 요금`);
  const boarding = r.vd?.boarding ? fare?.boarding ?? general?.boarding ?? null : null;
  if (r.vd?.boarding && boarding == null) missing.push(`${ship} 승선 금액`);
  return { date, row: r, ship, kind, manual, fare: amount, boarding, total: (amount ?? 0) + (boarding ?? 0), missing };
}

/** 기간 선박비: 날짜별로 배를 탄 차량마다 한 건 */
export function shipCosts(snap: Snapshot, from: string, to: string): Voyage[] {
  const idx = buildIndex(snap);
  const out: Voyage[] = [];
  for (const d of eachDay(from, to)) {
    const board = buildBoard(snap, d, idx);
    for (const r of board.rows) if (sails(r)) out.push(voyageOf(snap, d, r));
  }
  return out;
}

/** 품목 벌크 요금 저장 (fee 가 null 이면 지움) */
export function setBulkFee(tx: Tx, productId: string, calc: CalcMethod, fee: number | null) {
  const cur = tx.list('product_bulk_fees').find((f) => f.product_id === productId);
  if (fee == null) { if (cur) tx.remove('product_bulk_fees', cur.id); return; }
  if (cur) tx.update('product_bulk_fees', cur.id, { calc_method: calc, fee });
  else tx.insert('product_bulk_fees', { id: newId(), product_id: productId, calc_method: calc, fee });
}

export interface BulkShipment {
  order: DailyOrder;
  /** 실제 선적일 (나중 선적이면 그날) */
  date: string;
  ship: string;
  fee: number | null;
  missing: string;
}

/** 기간 벌크 선적비: 벌크 상차마다 품목 요금 (대기는 아직 안 실음) */
export function bulkCosts(snap: Snapshot, from: string, to: string): BulkShipment[] {
  const out: BulkShipment[] = [];
  for (const o of snap.daily_orders) {
    if (o.kind !== 'load' || o.shipment !== 'bulk' || !o.departure_ship || isWaitShip(o.departure_ship)) continue;
    const date = o.ship_date ?? o.date;
    if (date < from || date > to) continue;
    const f = o.product_id ? (snap.product_bulk_fees ?? []).find((x) => x.product_id === o.product_id) : undefined;
    let fee: number | null = null;
    let missing = '';
    if (!f) missing = '품목 벌크 요금 미등록';
    else if (f.calc_method === 'fixed') fee = f.fee;
    else if (o.quantity == null) missing = '수량 없음';
    else fee = Math.round(f.fee * o.quantity);
    out.push({ order: o, date, ship: parseShip(o.departure_ship).name, fee, missing });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
