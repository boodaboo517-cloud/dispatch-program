import { saveOrder } from './orders.ts';
import { attachDefaultRevenue } from './revenue.ts';
import type { Tx } from './tx.ts';
import type { DailyOrder } from './types.ts';

/** 새 오더 입력: 저장 + (상차면) 연결 하차 + 품목 기본 단가 자동 입력 */
export function createOrder(tx: Tx, order: DailyOrder): DailyOrder {
  const o = saveOrder(tx, order, { userEdit: false });
  attachDefaultRevenue(tx, o);
  return tx.get('daily_orders', o.id)!;
}
