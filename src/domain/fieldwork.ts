// 현장근무 — 고정 근무는 반복 발주와 같은 버전 방식(변경 시 과거 불변, 직접 수정 보존)
import { addDays, eachDay, maxDate, weekdayOf } from './dates.ts';
import { newId } from './ids.ts';
import { HORIZON_DAYS, assertStartDate, closeVersionsFrom, versionOn } from './recurring.ts';
import { Tx } from './tx.ts';
import type { FieldAssignment, Mutation, RecurringFieldVersion, Snapshot } from './types.ts';

export type FieldFields = Pick<RecurringFieldVersion, 'weekdays' | 'site_id' | 'task' | 'vehicle_id'>;

export function blankField(p: Partial<FieldAssignment> & { date: string }): FieldAssignment {
  return {
    id: newId(), site_id: null, staff_id: null, task: '', vehicle_id: null, source: 'manual',
    recurring_field_id: null, recurring_field_version_id: null, edited_manually: false, is_off: false,
    maintenance_record_id: null, sort_order: 0, ...p,
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
    // 휴무 지정된 날은 만들지 않는다
    if (tx.list('field_assignments').some((f) => f.date === d && f.staff_id === rec.staff_id && f.is_off)) continue;
    tx.insert('field_assignments', blankField({
      date: d, site_id: v.site_id, staff_id: rec.staff_id, task: v.task, vehicle_id: v.vehicle_id,
      source: 'recurring', recurring_field_id: recId, recurring_field_version_id: v.id,
    }));
    n++;
  }
  return n;
}

const done = (tx: Tx, extra: Record<string, number> = {}) => ({ mutations: tx.mutations() as Mutation[], snapshot: tx.result(), ...extra });

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

export function planFieldExtension(snap: Snapshot, today: string, actor: string | null = 'scheduler') {
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
    for (const f of rows.filter((f) => !f.is_off && f.source === 'recurring')) tx.remove('field_assignments', f.id);
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
