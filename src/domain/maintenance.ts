// 정비·주행거리·소모품 주기 계산
import { addDays, diffDays } from './dates.ts';
import { newId } from './ids.ts';
import type { Tx } from './tx.ts';
import type {
  MaintenanceKind, MaintenanceRecord, MaintenanceSchedule, OdometerLog, Snapshot, Vehicle,
} from './types.ts';

export const DEFAULT_OIL_INTERVAL_KM = 15000;
export const ODOMETER_MAX_PER_DAY = 2000;
export const ODOMETER_REMIND_DAYS = 7;
export const DUE_SOON_DAYS = 14;
export const ALERT_BEFORE_DAYS = 3;
export const OIL_ALERT_KM = 1000;

/** 날짜에 정비 중인 기록 (종료일이 없으면 계속 정비 중) */
export function activeRepair(records: MaintenanceRecord[], vehicleId: string, date: string) {
  return records.find(
    (r) => r.vehicle_id === vehicleId && r.start_date <= date && (r.end_date === null || r.end_date >= date),
  );
}

export const repairMemo = (r: MaintenanceRecord) => [r.kind, r.shop].filter(Boolean).join(' · ') + (r.memo ? ` (${r.memo})` : '');

function logsOf(logs: OdometerLog[], vehicleId: string) {
  return logs.filter((l) => l.vehicle_id === vehicleId).sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
}

/** 주행거리 입력 검증: 이전 값보다 작거나 하루 2,000km 이상 늘면 확인 요청 */
export function checkOdometer(logs: OdometerLog[], vehicleId: string, date: string, km: number): string[] {
  const warnings: string[] = [];
  const prev = logsOf(logs, vehicleId).filter((l) => l.date <= date).pop();
  if (prev) {
    if (km < prev.km) warnings.push(`이전 값(${prev.date} ${prev.km.toLocaleString()}km)보다 작습니다`);
    const days = Math.max(1, diffDays(date, prev.date));
    if ((km - prev.km) / days >= ODOMETER_MAX_PER_DAY) {
      warnings.push(`하루 ${ODOMETER_MAX_PER_DAY.toLocaleString()}km 이상 늘었습니다 (${(km - prev.km).toLocaleString()}km / ${days}일)`);
    }
  }
  const next = logsOf(logs, vehicleId).find((l) => l.date > date);
  if (next && km > next.km) warnings.push(`이후 기록(${next.date} ${next.km.toLocaleString()}km)보다 큽니다`);
  return warnings;
}

export function currentOdometer(snap: Pick<Snapshot, 'odometer_logs' | 'maintenance_records'>, vehicleId: string) {
  const candidates: { date: string; km: number }[] = [
    ...logsOf(snap.odometer_logs, vehicleId),
    ...snap.maintenance_records
      .filter((r) => r.vehicle_id === vehicleId && r.odometer_km != null)
      .map((r) => ({ date: r.start_date, km: r.odometer_km! })),
  ];
  candidates.sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
  return candidates.pop() ?? null;
}

/** 최근 평균 하루 주행거리 (기본 최근 60일 기록) */
export function avgDailyKm(logs: OdometerLog[], vehicleId: string, today: string, windowDays = 60): number | null {
  const ls = logsOf(logs, vehicleId).filter((l) => l.date >= addDays(today, -windowDays) && l.date <= today);
  if (ls.length < 2) return null;
  const first = ls[0];
  const last = ls[ls.length - 1];
  const days = diffDays(last.date, first.date);
  if (days <= 0) return null;
  return (last.km - first.km) / days;
}

export type Level = 'ok' | 'warn' | 'over' | 'unknown';

export interface ConsumableStatus {
  kind: MaintenanceKind;
  intervalKm: number;
  lastKm: number | null;
  lastDate: string | null;
  currentKm: number | null;
  usedKm: number | null;
  remainingKm: number | null;
  ratio: number | null;
  level: Level;
  expectedDate: string | null;
}

/** 엔진오일 등 km 주기 소모품: 남은 km, 진행률(70% 노랑·100% 빨강), 예상 교환일 */
export function consumableStatus(
  snap: Pick<Snapshot, 'odometer_logs' | 'maintenance_records'>,
  vehicleId: string,
  kind: MaintenanceKind,
  intervalKm: number,
  today: string,
): ConsumableStatus {
  const last = snap.maintenance_records
    .filter((r) => r.vehicle_id === vehicleId && r.kind === kind && r.odometer_km != null)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .pop();
  const cur = currentOdometer(snap, vehicleId);
  const base: ConsumableStatus = {
    kind, intervalKm, lastKm: last?.odometer_km ?? null, lastDate: last?.start_date ?? null,
    currentKm: cur?.km ?? null, usedKm: null, remainingKm: null, ratio: null, level: 'unknown', expectedDate: null,
  };
  if (!last || !cur) return base;
  const used = Math.max(0, cur.km - last.odometer_km!);
  const remaining = intervalKm - used;
  const ratio = used / intervalKm;
  const avg = avgDailyKm(snap.odometer_logs, vehicleId, today);
  return {
    ...base,
    usedKm: used,
    remainingKm: remaining,
    ratio,
    level: ratio >= 1 ? 'over' : ratio >= 0.7 ? 'warn' : 'ok',
    expectedDate: avg && avg > 0 ? addDays(cur.date, Math.max(0, Math.ceil(remaining / avg))) : null,
  };
}

export function oilStatus(snap: Snapshot, v: Vehicle, today: string) {
  const def = Number(snap.settings.find((s) => s.key === 'oil_interval_km')?.value) || DEFAULT_OIL_INTERVAL_KM;
  return consumableStatus(snap, v.id, '엔진오일', v.oil_interval_km ?? def, today);
}

export interface DueInfo {
  schedule: MaintenanceSchedule;
  dueDate: string | null;
  dueKm: number | null;
  daysLeft: number | null;
  kmLeft: number | null;
  state: 'overdue' | 'soon' | 'ok';
}

/** 주기(날짜·km) → 다음 예정. 이력이 등록되면 마지막 기록 기준으로 자동 계산 */
export function nextDue(snap: Snapshot, s: MaintenanceSchedule, today: string): DueInfo {
  const last = snap.maintenance_records
    .filter((r) => r.vehicle_id === s.vehicle_id && r.kind === s.kind)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .pop();
  let dueDate = s.due_date;
  if (s.interval_days && last) {
    const fromLast = addDays(last.end_date ?? last.start_date, s.interval_days);
    dueDate = !dueDate || fromLast > dueDate ? fromLast : dueDate;
  }
  const dueKm = s.interval_km && last?.odometer_km != null ? last.odometer_km + s.interval_km : null;
  const cur = currentOdometer(snap, s.vehicle_id);
  const daysLeft = dueDate ? diffDays(dueDate, today) : null;
  const kmLeft = dueKm != null && cur ? dueKm - cur.km : null;
  const overdue = (daysLeft != null && daysLeft < 0) || (kmLeft != null && kmLeft < 0);
  const soon = (daysLeft != null && daysLeft <= DUE_SOON_DAYS) || (kmLeft != null && kmLeft <= OIL_ALERT_KM);
  return { schedule: s, dueDate, dueKm, daysLeft, kmLeft, state: overdue ? 'overdue' : soon ? 'soon' : 'ok' };
}

export interface MaintenanceAlert {
  vehicle_id: string;
  level: 'warn' | 'over';
  message: string;
}

/** 관리자 알림: 예정 3일 전·기한 지남, 오일 1,000km 이하, 주행거리 1주 미입력 */
export function maintenanceAlerts(snap: Snapshot, today: string): MaintenanceAlert[] {
  const out: MaintenanceAlert[] = [];
  const name = (id: string) => snap.vehicles.find((v) => v.id === id)?.short_no ?? '';
  for (const s of snap.maintenance_schedules) {
    const d = nextDue(snap, s, today);
    if (d.state === 'overdue') out.push({ vehicle_id: s.vehicle_id, level: 'over', message: `${name(s.vehicle_id)} ${s.kind} 기한 지남 (${d.dueDate ?? `${d.dueKm}km`})` });
    else if (d.daysLeft != null && d.daysLeft <= ALERT_BEFORE_DAYS) out.push({ vehicle_id: s.vehicle_id, level: 'warn', message: `${name(s.vehicle_id)} ${s.kind} ${d.daysLeft}일 남음 (${d.dueDate})` });
  }
  for (const v of snap.vehicles) {
    if (v.usage !== '배차') continue;
    const o = oilStatus(snap, v, today);
    if (o.remainingKm != null && o.remainingKm <= OIL_ALERT_KM) {
      out.push({ vehicle_id: v.id, level: o.remainingKm < 0 ? 'over' : 'warn', message: `${v.short_no} 엔진오일 ${o.remainingKm < 0 ? `${-o.remainingKm}km 초과` : `${o.remainingKm}km 남음`}` });
    }
    const last = logsOf(snap.odometer_logs, v.id).pop();
    if (!last || diffDays(today, last.date) >= ODOMETER_REMIND_DAYS) {
      out.push({ vehicle_id: v.id, level: 'warn', message: `${v.short_no} 주행거리 미입력 (${last ? `${last.date} 이후` : '기록 없음'})` });
    }
  }
  return out;
}

export function saveMaintenance(tx: Tx, rec: MaintenanceRecord) {
  if (tx.get('maintenance_records', rec.id)) tx.update('maintenance_records', rec.id, rec);
  else tx.insert('maintenance_records', rec);
  syncMaintenanceFieldTask(tx, rec.id);
}

export function deleteMaintenance(tx: Tx, id: string) {
  tx.remove('maintenance_records', id);
  for (const f of tx.list('field_assignments').filter((f) => f.maintenance_record_id === id)) tx.remove('field_assignments', f.id);
}

/** 정비실 근무자가 입고 처리하면 현장근무 업무란에 "8953 적재함 수리 입고" 자동 표시 */
export function syncMaintenanceFieldTask(tx: Tx, recordId: string) {
  const r = tx.get('maintenance_records', recordId);
  const existing = tx.list('field_assignments').filter((f) => f.maintenance_record_id === recordId);
  if (!r || !r.staff_id) {
    for (const f of existing) tx.remove('field_assignments', f.id);
    return;
  }
  const v = tx.get('vehicles', r.vehicle_id);
  const task = `${v?.short_no ?? ''} ${r.kind} 입고`.trim();
  const site = tx.list('field_sites').find((s) => s.name === '정비실') ?? null;
  const row = existing[0];
  if (row) {
    tx.update('field_assignments', row.id, { date: r.start_date, staff_id: r.staff_id, task });
    for (const f of existing.slice(1)) tx.remove('field_assignments', f.id);
    return;
  }
  tx.insert('field_assignments', {
    id: newId(), date: r.start_date, site_id: site?.id ?? null, staff_id: r.staff_id, task, vehicle_id: null,
    source: 'maintenance', recurring_field_id: null, recurring_field_version_id: null, edited_manually: false,
    is_off: false, maintenance_record_id: r.id, sort_order: 999,
  });
}
