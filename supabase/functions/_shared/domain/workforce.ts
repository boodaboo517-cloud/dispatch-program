// 기사 근무 기록: 근무형태 선택, 알바 출근, 월간 근무현황
import { eachDay } from './dates.ts';
import { newId } from './ids.ts';
import { isDriverWorking } from './board.ts';
import type { Tx } from './tx.ts';
import { WORK_TYPES, type Driver, type DriverWorkLog, type Snapshot, type WorkType } from './types.ts';

export function workLogOf(snap: Pick<Snapshot, 'driver_work_logs'>, driverId: string, date: string): DriverWorkLog | undefined {
  return (snap.driver_work_logs ?? []).find((l) => l.driver_id === driverId && l.date === date);
}

/** 근무형태 저장. 형태도 메모도 없으면 기록을 지운다 (알바는 출근 취소) */
export function setWorkLog(tx: Tx, p: { date: string; driver_id: string; work_types: WorkType[]; memo?: string }) {
  const cur = tx.list('driver_work_logs').find((l) => l.driver_id === p.driver_id && l.date === p.date);
  const memo = p.memo ?? cur?.memo ?? '';
  const types = WORK_TYPES.filter((t) => p.work_types.includes(t)); // 순서 고정 · 중복 제거
  if (!types.length && !memo) {
    if (cur) tx.remove('driver_work_logs', cur.id);
    return;
  }
  if (cur) tx.update('driver_work_logs', cur.id, { work_types: types, memo });
  else tx.insert('driver_work_logs', { id: newId(), date: p.date, driver_id: p.driver_id, work_types: types, memo });
}

/** 그날 차량 줄·오더에 배차된 기사 */
export function assignedDriverIds(snap: Snapshot, date: string): Set<string> {
  const ids = new Set<string>();
  for (const v of snap.vehicle_days) if (v.date === date && v.driver_id) ids.add(v.driver_id);
  for (const o of snap.daily_orders) if (o.date === date && o.driver_id) ids.add(o.driver_id);
  return ids;
}

export interface DayCell {
  date: string;
  types: WorkType[];
  memo: string;
  assigned: boolean;
  /** 근무일(근무조 기준·특근 기록 포함)인지 */
  scheduled: boolean;
  off: boolean;
}

export interface DriverMonth {
  driver: Driver;
  days: DayCell[];
  /** 실제 근무한 날 = 근무 기록이 있거나 배차된 날 */
  workedDays: number;
  byType: Record<WorkType, number>;
  /** 배차는 됐지만 근무형태를 안 고른 날 */
  missingType: number;
}

/** 월간 기사 근무현황 (from~to 포함) */
export function monthlyDriverStatus(snap: Snapshot, from: string, to: string, drivers: Driver[] = snap.drivers): DriverMonth[] {
  const days = [...eachDay(from, to)];
  const assigned = new Map(days.map((d) => [d, assignedDriverIds(snap, d)]));
  return drivers.map((driver) => {
    const byType = Object.fromEntries(WORK_TYPES.map((t) => [t, 0])) as Record<WorkType, number>;
    let workedDays = 0;
    let missingType = 0;
    const cells = days.map((date): DayCell => {
      const log = workLogOf(snap, driver.id, date);
      const isAssigned = assigned.get(date)!.has(driver.id);
      const off = snap.field_assignments.some((f) => f.date === date && f.staff_id === driver.id && f.is_off);
      const types = log?.work_types ?? [];
      if (types.length || isAssigned) workedDays++;
      if (isAssigned && !types.length) missingType++;
      for (const t of types) byType[t]++;
      return { date, types, memo: log?.memo ?? '', assigned: isAssigned, scheduled: isDriverWorking(snap, driver, date), off };
    });
    return { driver, days: cells, workedDays, byType, missingType };
  });
}
