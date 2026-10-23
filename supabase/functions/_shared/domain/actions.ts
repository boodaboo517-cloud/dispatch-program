import { newId } from './ids.ts';
import { saveOrder } from './orders.ts';
import { attachDefaultRevenue, saveRevenue } from './revenue.ts';
import type { Tx } from './tx.ts';
import type { DailyOrder } from './types.ts';

/** 새 오더 입력: 저장 + (상차면) 연결 하차 + 품목 기본 단가 자동 입력 */
export function createOrder(tx: Tx, order: DailyOrder): DailyOrder {
  const o = saveOrder(tx, order, { userEdit: false });
  attachDefaultRevenue(tx, o);
  return tx.get('daily_orders', o.id)!;
}

/** "3대"처럼 대 단위 2대 이상 → 차량마다 따로 배차해야 하므로 1대씩 나눌 대상 */
export const isPerVehicleSplittable = (o: Pick<DailyOrder, 'unit' | 'quantity' | 'source'>) =>
  o.unit === '대' && o.quantity != null && Number.isInteger(o.quantity) && o.quantity >= 2 && o.source !== 'linked';

/**
 * 대 단위 오더를 1대씩 나눈다. 첫 건은 차량·기사를 그대로 두고, 나머지는 배차 대기(차량 없음)로.
 * 반복 발주 오더면 나눈 건도 같은 반복 발주에 속한다.
 * 상차면 나뉜 건마다 반대편 하차도 따로 생긴다. 돌려주는 값 = 나뉜 오더 id (원래 것 포함)
 */
export function splitPerVehicle(tx: Tx, orderId: string): string[] {
  const o = tx.get('daily_orders', orderId);
  if (!o || !isPerVehicleSplittable(o)) return o ? [o.id] : [];
  const n = o.quantity!;
  saveOrder(tx, { ...o, quantity: 1 }, { userEdit: false });
  const rev = tx.list('order_revenue').find((r) => r.order_id === o.id);
  if (rev && rev.quantity === n) saveRevenue(tx, { ...rev, quantity: 1 });
  const ids = [o.id];
  const later = tx.list('daily_orders').filter((x) => x.date === o.date && x.zone === o.zone && x.kind === o.kind && x.sort_order > o.sort_order);
  for (const x of later) tx.update('daily_orders', x.id, { sort_order: x.sort_order + n - 1 });
  for (let i = 1; i < n; i++) {
    const copy = createOrder(tx, {
      ...tx.get('daily_orders', o.id)!,
      id: newId(), quantity: 1, vehicle_id: null, driver_id: null,
      // 반복 발주에서 나온 건은 나눈 것도 반복 발주 소속으로 (변경·종료 때 함께 다시 만들어짐)
      source: o.source, recurring_order_id: o.recurring_order_id, recurring_version_id: o.recurring_version_id, edited_manually: o.edited_manually,
      linked_from_id: null, link_status: 'none', link_pending: null, sort_order: o.sort_order + i,
    });
    ids.push(copy.id);
  }
  return ids;
}

/**
 * 오더 복사: 같은 내용으로 새 오더 한 건 (날짜를 바꿀 수 있음). keepVehicle 이 아니면 배차 대기로.
 * 상차면 반대편 하차도 새로 생기고, 금액을 넣어 두었으면 금액도 복사(청구 상태는 미청구). "N대"면 1대씩 나눈다.
 */
export function copyOrder(tx: Tx, orderId: string, p: { date: string; keepVehicle: boolean }): string[] {
  const o = tx.get('daily_orders', orderId);
  if (!o) return [];
  const sameSlot = tx.list('daily_orders').filter((x) => x.date === p.date && x.zone === o.zone && x.kind === o.kind);
  const copy = createOrder(tx, {
    ...o,
    id: newId(), date: p.date,
    vehicle_id: p.keepVehicle ? o.vehicle_id : null, driver_id: p.keepVehicle ? o.driver_id : null,
    source: 'manual', recurring_order_id: null, recurring_version_id: null, edited_manually: false,
    linked_from_id: null, link_status: 'none', link_pending: null, sort_order: sameSlot.length,
  });
  const rev = tx.list('order_revenue').find((r) => r.order_id === o.id);
  if (rev) {
    const auto = tx.list('order_revenue').find((r) => r.order_id === copy.id);
    if (auto) tx.remove('order_revenue', auto.id);
    saveRevenue(tx, { ...rev, id: newId(), order_id: copy.id, billing_status: '미청구' });
  }
  return splitPerVehicle(tx, copy.id);
}
