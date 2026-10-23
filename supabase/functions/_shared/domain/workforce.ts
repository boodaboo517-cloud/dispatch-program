// 기사 근무 기록: 근무형태 선택, 알바 출근, 월간 근무현황
import { eachDay, weekdayOf } from './dates.ts';
import { newId } from './ids.ts';
import { isDriverWorking } from './board.ts';
import { planFieldRecurringChange } from './fieldwork.ts';
import { versionOn } from './recurring.ts';
import { Tx, applyMutations } from './tx.ts';
import { ON_CALL_SHIFT, WORK_TYPES, guessDriverZone, type Driver, type DriverWorkLog, type Mutation, type Snapshot, type Weekday, type WorkType, type Zone } from './types.ts';

const ALL_WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** 고정 휴무 요일 (매주). 근무 요일의 나머지. 알바·근무 요일 미지정(매일 근무)은 없음 */
export function fixedOffDays(d: Pick<Driver, 'work_days' | 'shift'>): Weekday[] {
  if (d.shift === ON_CALL_SHIFT || !d.work_days.length) return [];
  return ALL_WEEKDAYS.filter((w) => !d.work_days.includes(w));
}

/** 고정 휴무 요일 → 근무 요일 (휴무 없음 = 매일 근무 = 빈 목록) */
export function workDaysFromOff(off: Weekday[]): Weekday[] {
  return off.length ? ALL_WEEKDAYS.filter((w) => !off.includes(w)) : [];
}

/** 그날 휴무자 (휴무 지정 + 매주 고정 휴무) 를 근무 지역별로 */
export function offByZone(snap: Snapshot, date: string): Record<Zone, Driver[]> {
  const ids = new Set(snap.field_assignments.filter((f) => f.date === date && f.is_off && f.staff_id).map((f) => f.staff_id!));
  for (const d of weeklyOffOn(snap, date)) ids.add(d.id);
  // 고정 현장근무가 있는 직원이 그날 현장·차량 어디에도 없으면 휴무로 본다
  const working = assignedDriverIds(snap, date);
  for (const f of snap.field_assignments) if (f.date === date && !f.is_off && f.staff_id) working.add(f.staff_id);
  for (const r of snap.recurring_field_work) {
    if (!r.active || !r.staff_id || (r.generated_until && date > r.generated_until)) continue;
    if (!working.has(r.staff_id) && !workLogOf(snap, r.staff_id, date)) ids.add(r.staff_id);
  }
  const out: Record<Zone, Driver[]> = { land: [], jeju: [] };
  for (const d of snap.drivers) if (ids.has(d.id)) out[driverZone(d)].push(d);
  for (const k of Object.keys(out) as Zone[]) out[k].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return out;
}

/** 근무 지역 (지정 안 했으면 근무조·소속으로 추정) */
export const driverZone = (d: Driver): Zone => d.zone ?? guessDriverZone(d);

/** 그날 고정 휴무인 사람 (그날 배차되었거나 근무 기록이 있으면 제외) */
export function weeklyOffOn(snap: Snapshot, date: string): Driver[] {
  const wd = weekdayOf(date) as Weekday;
  const working = assignedDriverIds(snap, date);
  for (const f of snap.field_assignments) if (f.date === date && !f.is_off && f.staff_id) working.add(f.staff_id);
  return snap.drivers.filter((d) => fixedOffDays(d).includes(wd) && !working.has(d.id) && !workLogOf(snap, d.id, date));
}

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
  for (const v of snap.vehicle_days) {
    if (v.date !== date) continue;
    if (v.driver_id) ids.add(v.driver_id);
    if (v.load_driver_id) ids.add(v.load_driver_id);
    if (v.helper_driver_id) ids.add(v.helper_driver_id);
  }
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

/**
 * 고정 휴무일 바꾸기. 직원의 근무 요일을 고치고, 고정 현장근무가 있으면 오늘부터 그 요일로 맞춘다
 * (휴무 요일에는 현장근무 줄이 생기지 않아 일정표 "현장 휴무"에 나온다. 지난 날짜·직접 고친 줄은 그대로).
 */
export function planStaffFixedOff(snap: Snapshot, p: { staffId: string; off: Weekday[]; today: string }): { mutations: Mutation[]; recurringChanged: number } {
  const workDays = workDaysFromOff(p.off);
  const tx = new Tx(snap);
  tx.update('drivers', p.staffId, { work_days: workDays });
  const mutations = tx.mutations();
  let s = applyMutations(snap, mutations);
  const want = workDays.length ? workDays : ALL_WEEKDAYS;
  let recurringChanged = 0;
  for (const rec of s.recurring_field_work.filter((r) => r.active && r.staff_id === p.staffId)) {
    const versions = s.recurring_field_versions.filter((v) => v.recurring_field_id === rec.id).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    const v = versionOn(versions, p.today) ?? versions[versions.length - 1];
    if (!v) continue;
    if (v.weekdays.length === want.length && want.every((w) => v.weekdays.includes(w))) continue;
    const r = planFieldRecurringChange(s, {
      recurringId: rec.id, startDate: p.today, today: p.today,
      fields: { weekdays: want, site_id: v.site_id, task: v.task, vehicle_id: v.vehicle_id },
    });
    mutations.push(...r.mutations);
    s = applyMutations(s, r.mutations);
    recurringChanged++;
  }
  return { mutations, recurringChanged };
}
