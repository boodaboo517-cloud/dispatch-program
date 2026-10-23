import type { Mutation, TableName } from './types.ts';

/** 외래키 순서: 부모 테이블을 먼저 넣고, 지울 때는 반대 순서 */
export const WRITE_ORDER: TableName[] = [
  'settings', 'drivers', 'driver_work_logs', 'driver_pay_rates', 'ships', 'clients', 'products', 'product_pricing', 'product_photos', 'product_suggestions',
  'vehicles', 'recurring_orders', 'recurring_order_versions', 'daily_orders', 'vehicle_days', 'order_revenue',
  'field_sites', 'recurring_field_work', 'recurring_field_versions', 'maintenance_records', 'field_assignments',
  'maintenance_schedules', 'odometer_logs', 'notices',
];

export type Batch =
  | { table: TableName; op: 'upsert'; rows: Record<string, unknown>[] }
  | { table: TableName; op: 'delete'; ids: string[] };

export function toBatches(muts: Mutation[]): Batch[] {
  const out: Batch[] = [];
  for (const t of WRITE_ORDER) {
    const rows = muts.filter((m) => m.table === t && m.op === 'upsert').map((m) => (m as { row: Record<string, unknown> }).row);
    if (rows.length) out.push({ table: t, op: 'upsert', rows });
  }
  for (const t of [...WRITE_ORDER].reverse()) {
    const ids = muts.filter((m) => m.table === t && m.op === 'delete').map((m) => (m as { id: string }).id);
    if (ids.length) out.push({ table: t, op: 'delete', ids });
  }
  return out;
}
