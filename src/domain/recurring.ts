// 반복 발주 — 버전(effective_from/to) 방식.
// 규칙: 적용 시작일 이전 오더는 절대 건드리지 않는다. 시작일 이후라도 사람이 직접 고친 오더는 유지한다.
import { addDays, eachDay, inRange, maxDate, weekdayOf, weekdaysLabel } from './dates.ts';
import { newId } from './ids.ts';
import { blankOrder, deleteOrder, findLinkedUnload, saveOrder } from './orders.ts';
import { attachDefaultRevenue } from './revenue.ts';
import { Tx } from './tx.ts';
import type {
  DailyOrder, Mutation, RecurringOrder, RecurringOrderVersion, Snapshot, Weekday,
} from './types.ts';

/** 오늘부터 앞으로 8주까지 미리 만든다 */
export const HORIZON_DAYS = 56;

export type VersionFields = Omit<RecurringOrderVersion, 'id' | 'recurring_order_id' | 'effective_from' | 'effective_to' | 'updated_at' | 'updated_by'>;

interface Versioned {
  id: string;
  effective_from: string;
  effective_to: string | null;
}

export function versionOn<V extends Versioned>(versions: V[], date: string): V | undefined {
  return versions.find((v) => inRange(date, v.effective_from, v.effective_to));
}

export class RecurringRuleError extends Error {}

export function assertStartDate(startDate: string, today: string) {
  if (startDate < today) throw new RecurringRuleError('적용 시작일은 오늘 이후만 선택할 수 있습니다');
}

/**
 * 버전 나누기 (반복 발주·고정 근무 공통):
 * 시작일을 걸치는 버전은 effective_to = 시작일 - 1, 시작일 이후에 시작하는 예약 버전은 삭제.
 */
export function closeVersionsFrom<V extends Versioned>(
  tx: Tx,
  table: 'recurring_order_versions' | 'recurring_field_versions',
  versions: V[],
  startDate: string,
) {
  for (const v of versions) {
    if (v.effective_from >= startDate) tx.remove(table, v.id);
    else if (v.effective_to === null || v.effective_to >= startDate) {
      tx.update(table, v.id, { effective_to: addDays(startDate, -1) } as never);
    }
  }
}

function versionsOf(tx: Tx, recId: string) {
  return tx
    .list('recurring_order_versions')
    .filter((v) => v.recurring_order_id === recId)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
}

function ordersOf(tx: Tx, recId: string) {
  return tx.list('daily_orders').filter((o) => o.recurring_order_id === recId);
}

function buildOrder(tx: Tx, rec: RecurringOrder, ver: RecurringOrderVersion, date: string): DailyOrder {
  const product = tx.get('products', rec.product_id);
  const isLoad = rec.kind === 'load';
  const sameSlot = tx.list('daily_orders').filter((o) => o.date === date && o.zone === rec.zone && o.kind === rec.kind);
  return blankOrder({
    date,
    zone: rec.zone,
    kind: rec.kind,
    client_id: rec.client_id,
    product_id: rec.product_id,
    region: ver.region || product?.default_region || '',
    quantity: ver.quantity ?? product?.default_quantity ?? null,
    unit: ver.unit || product?.default_unit || '',
    memo: ver.memo,
    vehicle_id: ver.vehicle_id,
    arrival_ship: isLoad ? null : ver.ship,
    arrival_ship_tag: isLoad ? '' : ver.ship_tag,
    departure_ship: isLoad ? ver.ship : null,
    departure_ship_tag: isLoad ? ver.ship_tag : '',
    source: 'recurring',
    recurring_order_id: rec.id,
    recurring_version_id: ver.id,
    sort_order: sameSlot.length,
  });
}

/**
 * from~to 사이 요일에 맞는 날짜마다 오더를 만든다. 이미 그 날짜에 이 반복 발주의 오더가 있으면 건너뛴다.
 * 상차면 다음 날 반대 지역 하차까지 연쇄 생성(saveOrder → syncLinkedUnload).
 */
function generate(tx: Tx, rec: RecurringOrder, from: string, to: string): number {
  if (from > to) return 0;
  const versions = versionsOf(tx, rec.id);
  const taken = new Set(ordersOf(tx, rec.id).map((o) => o.date));
  let n = 0;
  for (const d of eachDay(from, to)) {
    if (taken.has(d)) continue;
    const ver = versionOn(versions, d);
    if (!ver || !ver.weekdays.includes(weekdayOf(d))) continue;
    const order = saveOrder(tx, buildOrder(tx, rec, ver, d), { userEdit: false });
    attachDefaultRevenue(tx, order);
    n++;
  }
  return n;
}

/** 자동 생성 오더 제거 (+연결 하차). 직접 수정된 것은 남기고 개수를 센다. */
function removeAutoOrders(tx: Tx, recId: string, fromDate: string) {
  let removed = 0;
  let keptManual = 0;
  for (const o of ordersOf(tx, recId)) {
    if (o.date < fromDate) continue; // 과거 불변
    if (o.edited_manually || o.source !== 'recurring') {
      keptManual++;
      continue;
    }
    const linked = findLinkedUnload(tx, o.id);
    if (linked?.edited_manually) {
      keptManual++;
      deleteOrder(tx, o.id, 'keep');
    } else {
      deleteOrder(tx, o.id, 'delete');
    }
    removed++;
  }
  return { removed, keptManual };
}

export interface RecurringResult {
  mutations: Mutation[];
  removed: number;
  created: number;
  keptManual: number;
  snapshot: Snapshot;
}

function finish(tx: Tx, r: { removed?: number; created?: number; keptManual?: number }): RecurringResult {
  return {
    mutations: tx.mutations(),
    removed: r.removed ?? 0,
    created: r.created ?? 0,
    keptManual: r.keptManual ?? 0,
    snapshot: tx.result(),
  };
}

const horizon = (today: string) => addDays(today, HORIZON_DAYS);

/** 새 반복 발주 등록: 시작일(기본 오늘) ~ 오늘+8주 */
export function planCreateRecurring(
  snap: Snapshot,
  p: { client_id: string; product_id: string | null; zone: RecurringOrder['zone']; kind: RecurringOrder['kind']; fields: VersionFields; startDate: string; today: string; actor?: string | null },
): RecurringResult & { recurringId: string } {
  assertStartDate(p.startDate, p.today);
  const tx = new Tx(snap, { actor: p.actor });
  const rec = tx.insert('recurring_orders', {
    id: newId(),
    client_id: p.client_id,
    product_id: p.product_id,
    zone: p.zone,
    kind: p.kind,
    active: true,
    generated_until: null,
  });
  tx.insert('recurring_order_versions', {
    id: newId(),
    recurring_order_id: rec.id,
    ...p.fields,
    effective_from: p.startDate,
    effective_to: null,
  });
  const until = horizon(p.today);
  const created = generate(tx, rec, p.startDate, until);
  tx.update('recurring_orders', rec.id, { generated_until: until });
  return { ...finish(tx, { created }), recurringId: rec.id };
}

/**
 * 반복 발주 변경 (적용 시작일부터 새 버전).
 * 기존 버전 effective_to = 시작일-1, 새 버전 effective_from = 시작일.
 * 시작일 이후 자동 오더만 지우고 새 버전으로 다시 만든다. 직접 수정 오더가 있는 날짜는 새로 만들지 않는다.
 */
export function planRecurringChange(
  snap: Snapshot,
  p: { recurringId: string; fields: VersionFields; startDate: string; today: string; actor?: string | null },
): RecurringResult {
  assertStartDate(p.startDate, p.today);
  const tx = new Tx(snap, { actor: p.actor });
  const rec = tx.get('recurring_orders', p.recurringId);
  if (!rec) throw new RecurringRuleError('반복 발주를 찾을 수 없습니다');
  closeVersionsFrom(tx, 'recurring_order_versions', versionsOf(tx, rec.id), p.startDate);
  tx.insert('recurring_order_versions', {
    id: newId(),
    recurring_order_id: rec.id,
    ...p.fields,
    effective_from: p.startDate,
    effective_to: null,
  });
  const { removed, keptManual } = removeAutoOrders(tx, rec.id, p.startDate);
  const until = maxDate(rec.generated_until ?? horizon(p.today), horizon(p.today));
  const created = generate(tx, { ...rec, active: true }, p.startDate, until);
  tx.update('recurring_orders', rec.id, { active: true, generated_until: until });
  return finish(tx, { removed, created, keptManual });
}

/** 반복 발주 종료: 종료일까지는 유지, 종료일 다음 날부터 자동 오더만 제거 */
export function planRecurringEnd(
  snap: Snapshot,
  p: { recurringId: string; endDate: string; today: string; actor?: string | null },
): RecurringResult {
  // 종료일 = 마지막으로 들어가는 날. 오늘을 종료일로 고르면 내일부터 없어진다. 어제 이전 종료는 과거를 바꾸므로 금지.
  assertStartDate(addDays(p.endDate, 1), p.today);
  const tx = new Tx(snap, { actor: p.actor });
  const rec = tx.get('recurring_orders', p.recurringId);
  if (!rec) throw new RecurringRuleError('반복 발주를 찾을 수 없습니다');
  const from = addDays(p.endDate, 1);
  for (const v of versionsOf(tx, rec.id)) {
    if (v.effective_from > p.endDate) tx.remove('recurring_order_versions', v.id);
    else if (v.effective_to === null || v.effective_to > p.endDate) {
      tx.update('recurring_order_versions', v.id, { effective_to: p.endDate });
    }
  }
  const { removed, keptManual } = removeAutoOrders(tx, rec.id, from);
  tx.update('recurring_orders', rec.id, { active: false });
  return finish(tx, { removed, keptManual });
}

/** 매일 새벽 스케줄러: 모든 활성 반복 발주를 오늘+8주까지 연장 */
export function planRecurringExtension(snap: Snapshot, today: string, actor: string | null = 'scheduler'): RecurringResult {
  const tx = new Tx(snap, { actor });
  const until = horizon(today);
  let created = 0;
  for (const rec of tx.list('recurring_orders')) {
    if (!rec.active) continue;
    const from = rec.generated_until ? addDays(rec.generated_until, 1) : today;
    if (from > until) continue;
    created += generate(tx, rec, maxDate(from, today), until);
    tx.update('recurring_orders', rec.id, { generated_until: until });
  }
  return finish(tx, { created });
}

export interface VersionSummary {
  weekdays: string;
  quantity: string;
  ship: string;
  region: string;
  memo: string;
}

export function summarizeVersion(v: Pick<RecurringOrderVersion, 'weekdays' | 'quantity' | 'unit' | 'ship' | 'ship_tag' | 'region' | 'memo'>): VersionSummary {
  return {
    weekdays: weekdaysLabel(v.weekdays as Weekday[]) || '-',
    quantity: v.quantity == null ? '-' : `${v.quantity}${v.unit}`,
    ship: v.ship ? `${v.ship_tag ? v.ship_tag + ' ' : ''}${v.ship}` : '-',
    region: v.region || '-',
    memo: v.memo || '',
  };
}

export interface ChangePreview {
  until: string; // 어제(시작일 - 1)
  startDate: string;
  before: VersionSummary | null;
  after: VersionSummary;
  removed: number;
  created: number;
  keptManual: number;
  pastUntouched: number;
}

/** 변경 전 미리보기: "~어제까지 기존 유지 / 시작일부터 새 내용" */
export function previewRecurringChange(
  snap: Snapshot,
  p: { recurringId: string; fields: VersionFields; startDate: string; today: string },
): ChangePreview {
  const res = planRecurringChange(snap, p);
  const before = versionOn(
    snap.recurring_order_versions.filter((v) => v.recurring_order_id === p.recurringId),
    p.startDate,
  ) ?? [...snap.recurring_order_versions].filter((v) => v.recurring_order_id === p.recurringId).pop();
  return {
    until: addDays(p.startDate, -1),
    startDate: p.startDate,
    before: before ? summarizeVersion(before) : null,
    after: summarizeVersion(p.fields),
    removed: res.removed,
    created: res.created,
    keptManual: res.keptManual,
    pastUntouched: snap.daily_orders.filter((o) => o.recurring_order_id === p.recurringId && o.date < p.startDate).length,
  };
}

/** 월별 달력용: 해당 날짜 반복 발주로 들어갈(들어간) 건수 */
export function recurringCountOn(snap: Snapshot, date: string): number {
  const existing = snap.daily_orders.filter((o) => o.date === date && o.source === 'recurring').length;
  if (existing) return existing;
  let n = 0;
  for (const rec of snap.recurring_orders) {
    if (!rec.active) continue;
    if (rec.generated_until && date <= rec.generated_until) continue;
    const v = versionOn(snap.recurring_order_versions.filter((x) => x.recurring_order_id === rec.id), date);
    if (v && v.weekdays.includes(weekdayOf(date))) n++;
  }
  return n;
}

export const activeVersion = (snap: Snapshot, recId: string, today: string) =>
  versionOn(snap.recurring_order_versions.filter((v) => v.recurring_order_id === recId), today) ??
  snap.recurring_order_versions
    .filter((v) => v.recurring_order_id === recId && v.effective_from > today)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];

