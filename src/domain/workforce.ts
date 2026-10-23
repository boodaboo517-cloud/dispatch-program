// 기사 근무 기록: 근무형태 선택, 알바 출근, 월간 근무현황
import { addDays, eachDay, weekdayOf } from './dates.ts';
import { newId } from './ids.ts';
import { isDriverWorking, setRowDriver, setRowHelper } from './board.ts';
import { planFieldRecurringChange, setDayOff } from './fieldwork.ts';
import { versionOn } from './recurring.ts';
import { Tx, applyMutations } from './tx.ts';
import { ON_CALL_SHIFT, WORK_TYPES, guessDriverZone, type Driver, type DriverDayPay, type DriverPayRate, type DriverWorkLog, type Mutation, type Snapshot, type Weekday, type WorkType, type Zone } from './types.ts';

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
export function setWorkLog(tx: Tx, p: { date: string; driver_id: string; work_types: WorkType[]; memo?: string; day_status?: '' | 'nonwork'; overtime_hours?: number | null }) {
  const cur = tx.list('driver_work_logs').find((l) => l.driver_id === p.driver_id && l.date === p.date);
  const memo = p.memo ?? cur?.memo ?? '';
  const day_status = p.day_status ?? '';
  const types = day_status === 'nonwork' ? [] : WORK_TYPES.filter((t) => p.work_types.includes(t)); // 순서 고정 · 중복 제거
  const overtime_hours = types.includes('시간외근무') ? p.overtime_hours ?? cur?.overtime_hours ?? null : null;
  if (!types.includes('시간외근무')) setDayPay(tx, { date: p.date, driver_id: p.driver_id, amount: null });
  if (!types.length && !memo && !day_status) {
    if (cur) tx.remove('driver_work_logs', cur.id);
    return;
  }
  const row = { work_types: types, memo, day_status, overtime_hours };
  if (cur) tx.update('driver_work_logs', cur.id, row);
  else tx.insert('driver_work_logs', { id: newId(), date: p.date, driver_id: p.driver_id, ...row });
}

/** 그날 시간외근무 금액 (직접 입력, 빈 값 = 지움 → 시간 × 시간당 수당으로 계산) */
export function setDayPay(tx: Tx, p: { date: string; driver_id: string; amount: number | null }) {
  const cur = tx.list('driver_day_pay').find((r) => r.driver_id === p.driver_id && r.date === p.date);
  if (p.amount == null || !Number.isFinite(p.amount)) { if (cur) tx.remove('driver_day_pay', cur.id); return; }
  const amount = Math.round(p.amount);
  if (cur) tx.update('driver_day_pay', cur.id, { amount });
  else tx.insert('driver_day_pay', { id: newId(), date: p.date, driver_id: p.driver_id, amount });
}

export function dayPayOf(snap: Pick<Snapshot, 'driver_day_pay'>, driverId: string, date: string): DriverDayPay | undefined {
  return (snap.driver_day_pay ?? []).find((r) => r.driver_id === driverId && r.date === date);
}

/** 그날 근무 처리: 근무(형태) / 휴무 / 근무일 아님 */
export function setDayKind(tx: Tx, p: { date: string; driver_id: string; kind: 'work' | 'off' | 'nonwork'; work_types?: WorkType[]; memo?: string; overtime_hours?: number | null }) {
  if (p.kind === 'off') {
    setWorkLog(tx, { date: p.date, driver_id: p.driver_id, work_types: [], memo: '' });
    setLeave(tx, { staffId: p.driver_id, from: p.date, to: p.date, reason: p.memo?.trim() || '휴무' });
    return;
  }
  cancelLeave(tx, { staffId: p.driver_id, from: p.date, to: p.date });
  setWorkLog(tx, { date: p.date, driver_id: p.driver_id, work_types: p.kind === 'work' ? p.work_types ?? [] : [], memo: p.memo, day_status: p.kind === 'nonwork' ? 'nonwork' : '', overtime_hours: p.overtime_hours });
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
  /** 차량 배차 또는 현장근무가 잡힌 날 */
  assigned: boolean;
  /** 현장근무로 잡힌 날 */
  field: boolean;
  /** 근무일 아님으로 지정 */
  nonwork: boolean;
  /** 시간외근무 시간 */
  overtimeHours: number | null;
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
  /** 시간외근무 시간 합계 */
  overtimeHours: number;
}

/** 월간 기사 근무현황 (from~to 포함) */
export function monthlyDriverStatus(snap: Snapshot, from: string, to: string, drivers: Driver[] = snap.drivers): DriverMonth[] {
  const days = [...eachDay(from, to)];
  const assigned = new Map(days.map((d) => [d, assignedDriverIds(snap, d)]));
  const fieldOn = new Set(snap.field_assignments.filter((f) => !f.is_off && f.staff_id && f.date >= from && f.date <= to).map((f) => `${f.date}|${f.staff_id}`));
  return drivers.map((driver) => {
    const byType = Object.fromEntries(WORK_TYPES.map((t) => [t, 0])) as Record<WorkType, number>;
    let workedDays = 0;
    let missingType = 0;
    let overtimeHours = 0;
    const cells = days.map((date): DayCell => {
      const log = workLogOf(snap, driver.id, date);
      const nonwork = log?.day_status === 'nonwork';
      const field = fieldOn.has(`${date}|${driver.id}`);
      const isAssigned = !nonwork && (assigned.get(date)!.has(driver.id) || field);
      const off = snap.field_assignments.some((f) => f.date === date && f.staff_id === driver.id && f.is_off);
      const types = log?.work_types ?? [];
      const hours = types.includes('시간외근무') ? log?.overtime_hours ?? null : null;
      if (types.length || isAssigned) workedDays++;
      if (isAssigned && !types.length) missingType++;
      for (const t of types) byType[t]++;
      overtimeHours += hours ?? 0;
      return { date, types, memo: log?.memo ?? '', assigned: isAssigned, field, nonwork, overtimeHours: hours, scheduled: isDriverWorking(snap, driver, date), off };
    });
    return { driver, days: cells, workedDays, byType, missingType, overtimeHours };
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

/** 휴무 사유 */
export const LEAVE_REASONS = ['휴가', '병가', '경조사', '개인사정', '기타'] as const;

/**
 * 휴무 기간 등록: 그 기간 매일 휴무로 (배차·현장근무 선택 목록에서 빠짐).
 * 이미 배차돼 있던 차량(오전·오후·동승)과 오더 기사는 비운다. 돌려주는 값 = 날짜 수, 비운 배차 수
 */
export function setLeave(tx: Tx, p: { staffId: string; from: string; to: string; reason: string }) {
  const from = p.from <= p.to ? p.from : p.to;
  const to = p.from <= p.to ? p.to : p.from;
  let days = 0;
  let cleared = 0;
  for (const d of eachDay(from, to)) {
    setDayOff(tx, d, p.staffId, true);
    const offRow = tx.list('field_assignments').find((f) => f.date === d && f.staff_id === p.staffId && f.is_off);
    if (offRow) tx.update('field_assignments', offRow.id, { task: p.reason || '휴무' });
    days++;
    for (const vd of tx.list('vehicle_days').filter((v) => v.date === d)) {
      if (vd.driver_id === p.staffId) { setRowDriver(tx, { date: d, vehicle_id: vd.vehicle_id, zone: vd.zone, driver_id: null, side: 'unload' }); cleared++; }
      const now = tx.get('vehicle_days', vd.id)!;
      if (now.load_driver_id === p.staffId) { setRowDriver(tx, { date: d, vehicle_id: vd.vehicle_id, zone: vd.zone, driver_id: null, side: 'load' }); cleared++; }
      if (now.helper_driver_id === p.staffId) { setRowHelper(tx, { date: d, vehicle_id: vd.vehicle_id, zone: vd.zone, driver_id: null, role: '' }); cleared++; }
    }
    for (const o of tx.list('daily_orders').filter((o) => o.date === d && o.driver_id === p.staffId)) tx.update('daily_orders', o.id, { driver_id: null });
  }
  return { days, cleared };
}

/** 휴무 기간 취소 */
export function cancelLeave(tx: Tx, p: { staffId: string; from: string; to: string }) {
  for (const d of eachDay(p.from, p.to)) setDayOff(tx, d, p.staffId, false);
}

/** 오늘 이후 휴무를 연속 기간으로 묶어서: [{from, to, reason}] */
export function leaveRanges(snap: Pick<Snapshot, 'field_assignments'>, staffId: string, fromDate: string) {
  const days = snap.field_assignments
    .filter((f) => f.staff_id === staffId && f.is_off && f.date >= fromDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: { from: string; to: string; reason: string }[] = [];
  for (const f of days) {
    const last = out[out.length - 1];
    if (last && addDays(last.to, 1) === f.date && last.reason === (f.task || '휴무')) last.to = f.date;
    else out.push({ from: f.date, to: f.date, reason: f.task || '휴무' });
  }
  return out;
}

/** 그 사람의 근무별 수당 */
export function payRatesOf(snap: Pick<Snapshot, 'driver_pay_rates'>, driverId: string): DriverPayRate | undefined {
  return (snap.driver_pay_rates ?? []).find((r) => r.driver_id === driverId);
}

/** 근무별 수당 한 칸 저장 (빈 값 = 지움) */
export function setPayRate(tx: Tx, p: { driver_id: string; type: WorkType; amount: number | null }) {
  const cur = tx.list('driver_pay_rates').find((r) => r.driver_id === p.driver_id);
  const rates = { ...(cur?.rates ?? {}) };
  if (p.amount == null || !Number.isFinite(p.amount)) delete rates[p.type];
  else rates[p.type] = Math.round(p.amount);
  if (cur) tx.update('driver_pay_rates', cur.id, { rates });
  else tx.insert('driver_pay_rates', { id: newId(), driver_id: p.driver_id, rates, memo: '' });
}

export interface PaySummary {
  /** 형태별 금액 = 횟수 × 수당 */
  byType: Partial<Record<WorkType, number>>;
  total: number;
  /** 횟수는 있는데 수당이 안 정해진 형태 */
  missingRate: WorkType[];
}

/**
 * 기간 근무현황 → 수당 합계. 시간외근무는 날마다: 직접 넣은 금액 → 없으면 시간 × 시간당 수당
 * (시간도 금액도 없으면 미입력으로 알림)
 */
export function paySummary(snap: Pick<Snapshot, 'driver_pay_rates' | 'driver_day_pay'>, m: DriverMonth): PaySummary {
  const rates = payRatesOf(snap, m.driver.id)?.rates ?? {};
  const byType: Partial<Record<WorkType, number>> = {};
  const missingRate: WorkType[] = [];
  let total = 0;
  for (const t of WORK_TYPES) {
    const n = m.byType[t];
    if (!n) continue;
    const rate = rates[t];
    if (t === '시간외근무') {
      let sum = 0;
      let missing = false;
      for (const c of m.days) {
        if (!c.types.includes(t)) continue;
        const direct = dayPayOf(snap, m.driver.id, c.date)?.amount;
        if (direct != null) sum += direct;
        else if (c.overtimeHours != null && rate != null) sum += c.overtimeHours * rate;
        else missing = true;
      }
      if (missing) missingRate.push(t);
      if (sum || !missing) { byType[t] = sum; total += sum; }
      continue;
    }
    if (rate == null) { missingRate.push(t); continue; }
    byType[t] = n * rate;
    total += n * rate;
  }
  return { byType, total, missingRate };
}
