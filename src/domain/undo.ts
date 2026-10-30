// 되돌리기 · 지난 일정 잠금 — 변경(Mutation) 묶음을 기준으로 계산하는 순수 함수
import { addDays } from './dates.ts';
import type { Mutation, Snapshot, TableName } from './types.ts';

type Row = { id: string } & Record<string, unknown>;

/** 날짜가 있는 일정 표 — 배차 담당자는 일주일 지난 줄을 고칠 수 없다 */
export const LOCKED_TABLES: TableName[] = ['daily_orders', 'vehicle_days', 'field_assignments', 'driver_work_logs', 'driver_day_pay'];
export const LOCK_DAYS = 7;

/** 이 날짜보다 앞선 일정은 잠김 (오늘-7일까지는 수정 가능) */
export function lockCutoff(today: string): string {
  return addDays(today, -LOCK_DAYS);
}

function findRow(snap: Snapshot, table: TableName, id: string): Row | undefined {
  return (snap[table] as unknown as Row[]).find((r) => r.id === id);
}

/** 잠긴 날짜를 건드리는 변경 (고치기 전·후 날짜 중 하나라도 기준일 이전이면 잠김) */
export function lockedMutations(snap: Snapshot, muts: Mutation[], today: string): Mutation[] {
  const cutoff = lockCutoff(today);
  const old = (d: unknown) => typeof d === 'string' && d !== '' && d < cutoff;
  return muts.filter((m) => {
    if (!LOCKED_TABLES.includes(m.table)) return false;
    const id = m.op === 'upsert' ? (m.row.id as string) : m.id;
    const before = findRow(snap, m.table, id);
    if (before && old(before.date)) return true;
    return m.op === 'upsert' && old(m.row.date);
  });
}

/**
 * 변경을 반영하기 전 상태로 돌리는 반대 변경.
 * 새로 만든 줄 → 지우기, 고친 줄 → 예전 값으로, 지운 줄 → 다시 만들기.
 * 같은 줄이 여러 번 바뀌었으면 맨 처음 상태로 돌린다.
 */
export function inverseMutations(snap: Snapshot, muts: Mutation[], stamp?: { at: string; by: string | null }): Mutation[] {
  const seen = new Set<string>();
  const out: Mutation[] = [];
  for (const m of muts) {
    const id = m.op === 'upsert' ? (m.row.id as string) : m.id;
    const k = `${m.table}:${id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const before = findRow(snap, m.table, id);
    if (!before) {
      if (m.op === 'upsert') out.push({ table: m.table, op: 'delete', id });
      continue;
    }
    if (m.op === 'upsert' && sameRow(before, m.row)) continue;
    const row = stamp ? { ...before, updated_at: stamp.at, updated_by: stamp.by } : { ...before };
    out.push({ table: m.table, op: 'upsert', row });
  }
  return out;
}

function sameRow(a: Row, b: Record<string, unknown>) {
  for (const k of Object.keys(b)) {
    if (k === 'updated_at' || k === 'updated_by') continue;
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) return false;
  }
  return true;
}
