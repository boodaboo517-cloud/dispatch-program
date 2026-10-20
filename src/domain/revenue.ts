import { newId } from './ids.ts';
import type { Tx } from './tx.ts';
import type { CalcMethod, DailyOrder, OrderRevenue, Snapshot } from './types.ts';

export const VAT_RATE = 0.1;
export const CALC_LABEL: Record<CalcMethod, string> = {
  per_pallet: '파렛트당',
  per_unit: '대당',
  fixed: '금액 직접',
};
export const EXTRA_PRESETS = ['야간', '대기', '경유'] as const;

export interface RevenueInput {
  calc_method: CalcMethod;
  unit_price: number | null;
  quantity: number | null;
  extras: { label: string; amount: number }[];
}

/** 단가 × 수량 (+ 추가요금) → 공급가 · 부가세 10% · 합계. 금액 직접이면 unit_price 가 곧 기본 금액 */
export function computeRevenue(i: RevenueInput) {
  if (i.unit_price === null) return { supply_amount: null, vat: null, total: null };
  const base = i.calc_method === 'fixed' ? i.unit_price : i.unit_price * (i.quantity ?? 0);
  const extra = i.extras.reduce((s, e) => s + (Number.isFinite(e.amount) ? e.amount : 0), 0);
  const supply = Math.round(base + extra);
  const vat = Math.round(supply * VAT_RATE);
  return { supply_amount: supply, vat, total: supply + vat };
}

export function defaultRevenueFor(tx: Tx, order: DailyOrder): OrderRevenue | null {
  if (!order.product_id) return null;
  const p = tx.list('product_pricing').find((x) => x.product_id === order.product_id);
  if (!p) return null;
  const input: RevenueInput = {
    calc_method: p.calc_method,
    unit_price: p.unit_price,
    quantity: order.quantity,
    extras: [],
  };
  return {
    id: newId(),
    order_id: order.id,
    ...input,
    ...computeRevenue(input),
    bill_to_client_id: order.client_id,
    billing_status: '미청구',
  };
}

/** 오더 생성 시 품목 기본 단가가 있으면 자동 입력 (연결 하차는 원본 상차에서 청구하므로 제외) */
export function attachDefaultRevenue(tx: Tx, order: DailyOrder) {
  if (order.source === 'linked') return;
  if (tx.list('order_revenue').some((r) => r.order_id === order.id)) return;
  const r = defaultRevenueFor(tx, order);
  if (r) tx.insert('order_revenue', r);
}

export function saveRevenue(tx: Tx, rev: OrderRevenue) {
  const row = { ...rev, ...computeRevenue(rev) };
  if (tx.get('order_revenue', rev.id)) tx.update('order_revenue', rev.id, row);
  else tx.insert('order_revenue', row);
}

/** "이 단가를 기본으로" — 품목 기본 단가만 바꾸고 과거 오더 금액은 그대로 둔다 */
export function setProductDefaultPrice(tx: Tx, productId: string, calc: CalcMethod, unitPrice: number) {
  const cur = tx.list('product_pricing').find((p) => p.product_id === productId);
  if (cur) tx.update('product_pricing', cur.id, { calc_method: calc, unit_price: unitPrice });
  else tx.insert('product_pricing', { id: newId(), product_id: productId, calc_method: calc, unit_price: unitPrice });
}

export interface RevenueLine {
  order: DailyOrder;
  rev: OrderRevenue | undefined;
}

export function revenueLines(snap: Snapshot, from: string, to: string): RevenueLine[] {
  const byOrder = new Map(snap.order_revenue.map((r) => [r.order_id, r]));
  return snap.daily_orders
    .filter((o) => o.date >= from && o.date <= to && o.source !== 'linked')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((order) => ({ order, rev: byOrder.get(order.id) }));
}

export function sumBy<K extends string>(lines: RevenueLine[], key: (l: RevenueLine) => K) {
  const m = new Map<K, { supply: number; vat: number; total: number; count: number; missing: number }>();
  for (const l of lines) {
    const k = key(l);
    const cur = m.get(k) ?? { supply: 0, vat: 0, total: 0, count: 0, missing: 0 };
    cur.count++;
    if (l.rev?.total == null) cur.missing++;
    else {
      cur.supply += l.rev.supply_amount ?? 0;
      cur.vat += l.rev.vat ?? 0;
      cur.total += l.rev.total;
    }
    m.set(k, cur);
  }
  return m;
}

export const won = (n: number | null | undefined) => (n == null ? '-' : `${n.toLocaleString('ko-KR')}원`);
