// 현장근무 — 고정 근무는 반복 발주와 같은 버전 방식(변경 시 과거 불변, 직접 수정 보존)
import { addDays, eachDay, maxDate, weekdayOf } from './dates.ts';
import { newId } from './ids.ts';
import { HORIZON_DAYS, assertStartDate, closeVersionsFrom, versionOn } from './recurring.ts';
import { Tx } from './tx.ts';
import type { FieldAssignment, FieldPart, Mutation, RecurringFieldVersion, Snapshot } from './types.ts';

export type FieldFields = Pick<RecurringFieldVersion, 'weekdays' | 'site_id' | 'task' | 'vehicle_id'>;

export function blankField(p: Partial<FieldAssignment> & { date: string }): FieldAssignment {
  return {
    id: newId(), site_id: null, staff_id: null, task: '', vehicle_id: null, source: 'manual',
    recurring_field_id: null, recurring_field_version_id: null, edited_manually: false, is_off: false,
    maintenance_record_id: null, sort_order: 0, part: '', ...p,
  };
}

function versionsOf(tx: Tx, id: string) {
  return tx.list('recurring_field_versions').filter((v) => v.recurring_field_id === id)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
}

function generate(tx: Tx, recId: string, from: string, to: string) {
  const rec = tx.get('recurring_field_work', recId)!;
  const versions = versionsOf(tx, recId);
  const taken = new Set(tx.list('field_assignments').filter((f) => f.recurring_field_id === recId).map((f) => f.date));
  let n = 0;
  for (const d of eachDay(from, to)) {
    if (taken.has(d)) continue;
    const v = versionOn(versions, d);
    if (!v || !v.weekdays.includes(weekdayOf(d))) continue;
    // 휴무 지정된 날 · 이미 그날 근무 줄이 있는 날(직접 넣은 줄 등)은 만들지 않는다 → 같은 사람이 두 번 나오지 않게
    if (tx.list('field_assignments').some((f) => f.date === d && f.staff_id === rec.staff_id && (f.is_off || f.source !== 'maintenance'))) continue;
    tx.insert('field_assignments', blankField({
      date: d, site_id: v.site_id, staff_id: rec.staff_id, task: v.task, vehicle_id: v.vehicle_id,
      source: 'recurring', recurring_field_id: recId, recurring_field_version_id: v.id,
    }));
    n++;
  }
  return n;
}

const done = (tx: Tx, c: { removed?: number; created?: number; keptManual?: number } = {}) => ({
  mutations: tx.mutations() as Mutation[],
  snapshot: tx.result(),
  removed: c.removed ?? 0,
  created: c.created ?? 0,
  keptManual: c.keptManual ?? 0,
});

export function planCreateFieldRecurring(snap: Snapshot, p: { staff_id: string; fields: FieldFields; startDate: string; today: string; actor?: string | null }) {
  assertStartDate(p.startDate, p.today);
  const tx = new Tx(snap, { actor: p.actor });
  const until = addDays(p.today, HORIZON_DAYS);
  const rec = tx.insert('recurring_field_work', { id: newId(), staff_id: p.staff_id, active: true, generated_until: until });
  tx.insert('recurring_field_versions', { id: newId(), recurring_field_id: rec.id, ...p.fields, effective_from: p.startDate, effective_to: null });
  const created = generate(tx, rec.id, p.startDate, until);
  return done(tx, { created });
}

export function planFieldRecurringChange(snap: Snapshot, p: { recurringId: string; fields: FieldFields; startDate: string; today: string; actor?: string | null }) {
  assertStartDate(p.startDate, p.today);
  const tx = new Tx(snap, { actor: p.actor });
  const rec = tx.get('recurring_field_work', p.recurringId)!;
  closeVersionsFrom(tx, 'recurring_field_versions', versionsOf(tx, rec.id), p.startDate);
  tx.insert('recurring_field_versions', { id: newId(), recurring_field_id: rec.id, ...p.fields, effective_from: p.startDate, effective_to: null });
  let removed = 0;
  let keptManual = 0;
  for (const f of tx.list('field_assignments').filter((f) => f.recurring_field_id === rec.id && f.date >= p.startDate)) {
    if (f.edited_manually) keptManual++;
    else {
      tx.remove('field_assignments', f.id);
      removed++;
    }
  }
  const until = maxDate(rec.generated_until ?? p.today, addDays(p.today, HORIZON_DAYS));
  const created = generate(tx, rec.id, p.startDate, until);
  tx.update('recurring_field_work', rec.id, { active: true, generated_until: until });
  return done(tx, { removed, created, keptManual });
}

export function planFieldRecurringEnd(snap: Snapshot, p: { recurringId: string; endDate: string; today: string; actor?: string | null }) {
  assertStartDate(addDays(p.endDate, 1), p.today);
  const tx = new Tx(snap, { actor: p.actor });
  for (const v of versionsOf(tx, p.recurringId)) {
    if (v.effective_from > p.endDate) tx.remove('recurring_field_versions', v.id);
    else if (v.effective_to === null || v.effective_to > p.endDate) tx.update('recurring_field_versions', v.id, { effective_to: p.endDate });
  }
  for (const f of tx.list('field_assignments').filter((f) => f.recurring_field_id === p.recurringId && f.date > p.endDate && !f.edited_manually)) {
    tx.remove('field_assignments', f.id);
  }
  tx.update('recurring_field_work', p.recurringId, { active: false });
  return done(tx);
}

export function planFieldExtension(snap: Snapshot, today: string, actor: string | null = null) {
  const tx = new Tx(snap, { actor });
  const until = addDays(today, HORIZON_DAYS);
  let created = 0;
  for (const r of tx.list('recurring_field_work')) {
    if (!r.active) continue;
    const from = r.generated_until ? addDays(r.generated_until, 1) : today;
    if (from > until) continue;
    created += generate(tx, r.id, maxDate(from, today), until);
    tx.update('recurring_field_work', r.id, { generated_until: until });
  }
  return done(tx, { created });
}

/** 그날만 다르게: 칸 수정 → 직접 수정 표시 */
export function saveFieldAssignment(tx: Tx, f: FieldAssignment) {
  const existing = tx.get('field_assignments', f.id);
  if (existing) tx.update('field_assignments', f.id, { ...f, edited_manually: f.source !== 'manual' ? true : f.edited_manually });
  else tx.insert('field_assignments', f);
}

/** 휴무 지정: 휴무자 줄을 만들고 그날 고정 근무는 숨긴다(삭제가 아니라 직접 수정으로 표시해 다시 생기지 않게) */
export function setDayOff(tx: Tx, date: string, staffId: string, off: boolean) {
  const rows = tx.list('field_assignments').filter((f) => f.date === date && f.staff_id === staffId);
  const offRow = rows.find((f) => f.is_off);
  if (off) {
    if (!offRow) tx.insert('field_assignments', blankField({ date, staff_id: staffId, is_off: true, task: '휴무' }));
    // 그날 근무 줄은 지운다 (정비실 입고로 생긴 줄은 정비 기록과 묶여 있어 그대로)
    for (const f of rows.filter((f) => !f.is_off && f.source !== 'maintenance')) tx.remove('field_assignments', f.id);
  } else if (offRow) {
    tx.remove('field_assignments', offRow.id);
  }
}

export function sitesGrouped(snap: Snapshot, rows: FieldAssignment[]) {
  const sites = [...snap.field_sites].sort((a, b) => a.sort_order - b.sort_order);
  const groups = sites.map((s) => ({ site: s, rows: rows.filter((r) => !r.is_off && r.site_id === s.id) }));
  const none = rows.filter((r) => !r.is_off && (!r.site_id || !sites.some((s) => s.id === r.site_id)));
  if (none.length) groups.push({ site: { id: '', name: '근무지 미정', sort_order: 999 }, rows: none });
  return { groups: groups.filter((g) => g.rows.length), off: rows.filter((r) => r.is_off) };
}

/** 그 직원의 평소 근무 (고정 근무 → 최근 근무 순): 근무지·업무·차량 */
export function usualField(snap: Pick<Snapshot, 'recurring_field_work' | 'recurring_field_versions' | 'field_assignments'>, staffId: string, date: string) {
  for (const r of snap.recurring_field_work.filter((x) => x.staff_id === staffId && x.active)) {
    const vs = snap.recurring_field_versions.filter((v) => v.recurring_field_id === r.id).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    const v = versionOn(vs, date) ?? vs[vs.length - 1];
    if (v) return { site_id: v.site_id, task: v.task, vehicle_id: v.vehicle_id, recurringId: r.id };
  }
  const last = snap.field_assignments
    .filter((f) => f.staff_id === staffId && !f.is_off && f.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return last ? { site_id: last.site_id, task: last.task, vehicle_id: last.vehicle_id, recurringId: null } : null;
}

/** 그날 근무로: 휴무 줄을 지우고, 근무 줄이 없으면 평소 근무지·업무로 한 줄 만든다 */
export function setStaffWorking(tx: Tx, date: string, staffId: string) {
  setDayOff(tx, date, staffId, false);
  const has = tx.list('field_assignments').some((f) => f.date === date && f.staff_id === staffId && !f.is_off);
  if (has) return;
  const u = usualField({ recurring_field_work: tx.list('recurring_field_work'), recurring_field_versions: tx.list('recurring_field_versions'), field_assignments: tx.list('field_assignments') }, staffId, date);
  const n = tx.list('field_assignments').filter((f) => f.date === date).length;
  tx.insert('field_assignments', blankField({ date, staff_id: staffId, site_id: u?.site_id ?? null, task: u?.task ?? '', vehicle_id: u?.vehicle_id ?? null, sort_order: n }));
}

/** 그날만 근무지 바꾸기 (줄이 없으면 만들고, 휴무였으면 근무로) */
export function setDaySite(tx: Tx, date: string, staffId: string, siteId: string | null) {
  setStaffWorking(tx, date, staffId);
  for (const f of tx.list('field_assignments').filter((f) => f.date === date && f.staff_id === staffId && !f.is_off)) {
    saveFieldAssignment(tx, { ...f, site_id: siteId });
  }
}

export interface StaffDayPlan {
  /** true = 휴무 */
  off: boolean;
  site_id: string | null;
  task: string;
  vehicle_id: string | null;
  /** 종일 / 오전 / 오후 */
  part?: FieldPart;
}

/** 그날 한 사람의 현장근무를 정한다: 휴무 / 근무(근무지·업무·차량). 같은 날 줄이 여러 개면 첫 줄을 고친다 */
export function setStaffDay(tx: Tx, date: string, staffId: string, p: StaffDayPlan) {
  if (p.off) return setDayOff(tx, date, staffId, true);
  setStaffWorking(tx, date, staffId);
  const f = tx.list('field_assignments').find((x) => x.date === date && x.staff_id === staffId && !x.is_off && x.source !== 'maintenance');
  if (f) saveFieldAssignment(tx, { ...f, site_id: p.site_id, task: p.task, vehicle_id: p.vehicle_id, part: p.part ?? f.part ?? '' });
}

/**
 * 기간으로 정하기 (from~to 포함). skipDays 에 든 요일(매주 쉬는 날)은 건너뛴다.
 * 돌아오는 날짜 수.
 */
export function setStaffRange(tx: Tx, p: { staffId: string; from: string; to: string; plan: StaffDayPlan; skipDays?: number[] }) {
  const [from, to] = p.from <= p.to ? [p.from, p.to] : [p.to, p.from];
  let n = 0;
  for (const d of eachDay(from, to)) {
    if (!p.plan.off && p.skipDays?.includes(weekdayOf(d))) continue;
    setStaffDay(tx, d, p.staffId, p.plan);
    n++;
  }
  return n;
}

/**
 * 같은 날 같은 사람 근무 줄이 겹치면 하나만 남긴다 (오전·오후처럼 시간이 다른 줄, 정비실 입고 줄은 그대로).
 * 남기는 순서: 직접 고친 줄 → 직접 넣은 줄 → 고정 근무 줄. 지운 줄 수를 돌려준다.
 */
export function dedupeFieldRows(tx: Tx, fromDate: string): number {
  const rank = (f: FieldAssignment) => (f.edited_manually ? 0 : f.source === 'manual' ? 1 : 2);
  const groups = new Map<string, FieldAssignment[]>();
  for (const f of tx.list('field_assignments')) {
    if (f.date < fromDate || !f.staff_id || f.is_off || f.source === 'maintenance') continue;
    const k = `${f.date}|${f.staff_id}|${f.part ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  let removed = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const [, ...extra] = [...rows].sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order);
    for (const f of extra) { tx.remove('field_assignments', f.id); removed++; }
  }
  // 휴무 줄도 하루 하나만
  const offs = new Map<string, FieldAssignment[]>();
  for (const f of tx.list('field_assignments')) {
    if (f.date < fromDate || !f.staff_id || !f.is_off) continue;
    const k = `${f.date}|${f.staff_id}`;
    offs.set(k, [...(offs.get(k) ?? []), f]);
  }
  for (const rows of offs.values()) for (const f of rows.slice(1)) { tx.remove('field_assignments', f.id); removed++; }
  return removed;
}

/** 현장근무 추가: 그 사람이 이 날 이미 근무 줄이 있으면 새로 만들지 않고 그 줄의 근무지를 바꾼다 */
export function addFieldPerson(tx: Tx, date: string, staffId: string, siteId: string | null) {
  setDayOff(tx, date, staffId, false);
  const cur = tx.list('field_assignments').find((f) => f.date === date && f.staff_id === staffId && !f.is_off && f.source !== 'maintenance');
  if (cur) return saveFieldAssignment(tx, { ...cur, site_id: siteId ?? cur.site_id });
  const n = tx.list('field_assignments').filter((f) => f.date === date).length;
  saveFieldAssignment(tx, blankField({ date, site_id: siteId, staff_id: staffId, sort_order: n }));
}

/** 그날 한 사람의 현장근무를 기사 일정처럼 한 줄로: 근무지 · 지급차량 · 오전 · 오후 (종일 줄이면 오전·오후 같음) */
export interface FieldDay {
  rows: FieldAssignment[];
  am: FieldAssignment | null;
  pm: FieldAssignment | null;
  site_id: string | null;
  vehicle_id: string | null;
}
export function fieldDayOf(rows: FieldAssignment[], staffId: string, date: string): FieldDay {
  const mine = rows.filter((f) => f.date === date && f.staff_id === staffId && !f.is_off && f.source !== 'maintenance')
    .sort((a, b) => a.sort_order - b.sort_order);
  const whole = mine.find((f) => !f.part) ?? null;
  const am = mine.find((f) => f.part === 'am') ?? whole;
  const pm = mine.find((f) => f.part === 'pm') ?? whole;
  const first = am ?? pm;
  return { rows: mine, am, pm, site_id: first?.site_id ?? null, vehicle_id: first?.vehicle_id ?? null };
}

const sameWork = (a: FieldAssignment, b: FieldAssignment) => a.site_id === b.site_id && a.vehicle_id === b.vehicle_id && a.task.trim() === b.task.trim();

/** 오전·오후 내용이 같아지면 다시 종일 한 줄로 */
function mergeHalves(tx: Tx, date: string, staffId: string) {
  const d = fieldDayOf(tx.list('field_assignments'), staffId, date);
  const am = d.rows.find((f) => f.part === 'am');
  const pm = d.rows.find((f) => f.part === 'pm');
  if (am && pm && sameWork(am, pm)) {
    saveFieldAssignment(tx, { ...am, part: '' });
    tx.remove('field_assignments', pm.id);
  }
}

/**
 * 오전 또는 오후만 고치기 (업무 · 근무지). 종일 한 줄이면 오전·오후 두 줄로 나눠 그 시간만 바꾼다.
 * none = 이 시간은 현장근무 없음 (예: 오후에 기사로 배차).
 */
export function setFieldHalf(tx: Tx, date: string, staffId: string, half: 'am' | 'pm', p: { task?: string; site_id?: string | null; none?: boolean }) {
  const other: 'am' | 'pm' = half === 'am' ? 'pm' : 'am';
  if (!p.none) setStaffWorking(tx, date, staffId);
  const d = fieldDayOf(tx.list('field_assignments'), staffId, date);
  const whole = d.rows.find((f) => !f.part);
  const patch = { ...(p.task !== undefined ? { task: p.task } : {}), ...(p.site_id !== undefined ? { site_id: p.site_id } : {}) };
  if (whole) {
    if (p.none) return saveFieldAssignment(tx, { ...whole, part: other });
    const next = { ...whole, ...patch };
    if (sameWork(next, whole)) return;
    // 종일 줄을 나눠: 원래 줄은 다른 시간, 새 줄은 이 시간
    saveFieldAssignment(tx, { ...whole, part: other });
    saveFieldAssignment(tx, blankField({ date, staff_id: staffId, site_id: whole.site_id, vehicle_id: whole.vehicle_id, task: whole.task, sort_order: whole.sort_order, ...patch, part: half }));
    return mergeHalves(tx, date, staffId);
  }
  const cur = d.rows.find((f) => f.part === half);
  if (p.none) {
    if (cur) tx.remove('field_assignments', cur.id);
    return;
  }
  if (cur) saveFieldAssignment(tx, { ...cur, ...patch });
  else {
    const base = d.rows.find((f) => f.part === other);
    saveFieldAssignment(tx, blankField({ date, staff_id: staffId, site_id: base?.site_id ?? null, vehicle_id: base?.vehicle_id ?? null, task: base?.task ?? '', sort_order: base?.sort_order ?? 0, ...patch, part: half }));
  }
  mergeHalves(tx, date, staffId);
}

/** 그날 근무지 · 지급차량 (· 종일 업무)를 오전·오후 모두 바꾸기 */
export function setFieldDay(tx: Tx, date: string, staffId: string, p: { site_id?: string | null; vehicle_id?: string | null; task?: string }) {
  setStaffWorking(tx, date, staffId);
  for (const f of fieldDayOf(tx.list('field_assignments'), staffId, date).rows) saveFieldAssignment(tx, { ...f, ...p });
  mergeHalves(tx, date, staffId);
}
