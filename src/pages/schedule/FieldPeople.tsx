// 현장근무 사람별 보기: 한 줄에 한 사람 — 근무/휴무 전환, 근무지(오늘만/계속), 업무, 지급 차량을 바로 바꾼다
import {
  ON_CALL_SHIFT, driverZone, offByZone, planFieldRecurringChange, saveFieldAssignment, setDayOff, setDaySite, setStaffWorking,
  usualField, versionOn, type Driver,
} from '../../domain/index.ts';
import { store } from '../../data/store.ts';
import { seoulToday } from '../../lib/time.ts';
import { useRole, useSnap } from '../../ui/hooks.ts';
import { ZONE_LABEL, vehicleNo } from '../../ui/labels.ts';
import { usePickers } from '../../ui/pickers.tsx';
import { Sheet, useSheet } from '../../ui/Sheet.tsx';
import { FieldPersonSheet } from './FieldPersonSheet.tsx';

export function FieldPeople({ date }: { date: string }) {
  const snap = useSnap();
  const { staff } = useRole();
  const pick = usePickers();
  const sheet = useSheet();
  const rows = snap.field_assignments.filter((f) => f.date === date);
  const byZone = offByZone(snap, date);
  const offIds = new Set([...byZone.jeju, ...byZone.land].map((d) => d.id));
  const siteName = (id: string | null) => snap.field_sites.find((s) => s.id === id)?.name ?? '';
  const hasRecurring = (id: string) => snap.recurring_field_work.some((r) => r.active && r.staff_id === id);

  const people = snap.drivers
    .filter((d) => d.shift !== ON_CALL_SHIFT && (d.staff_type !== '기사' || rows.some((f) => f.staff_id === d.id && !f.is_off) || hasRecurring(d.id)))
    .map((d) => {
      const mine = rows.filter((f) => f.staff_id === d.id && !f.is_off);
      const dayOff = rows.some((f) => f.staff_id === d.id && f.is_off);
      const off = dayOff || (!mine.length && offIds.has(d.id));
      return { d, mine, off, weekly: off && !dayOff };
    })
    .sort((a, b) => driverZone(b.d).localeCompare(driverZone(a.d)) || Number(a.off) - Number(b.off)
      || siteName(a.mine[0]?.site_id ?? null).localeCompare(siteName(b.mine[0]?.site_id ?? null), 'ko') || a.d.name.localeCompare(b.d.name, 'ko'));

  /** 오늘만 / 오늘부터 계속 */
  const askScope = () => new Promise<'day' | 'keep' | null>((resolve) => sheet.open((close) => (
    <Sheet title="근무지 바꾸기" onClose={() => { resolve(null); close(); }}>
      <div className="row" style={{ gap: 8 }}>
        <button className="grow" style={{ minHeight: 56, fontSize: 17 }} onClick={() => { resolve('day'); close(); }}>이 날만</button>
        <button className="grow primary" style={{ minHeight: 56, fontSize: 17 }} onClick={() => { resolve('keep'); close(); }}>이 날부터 계속</button>
      </div>
      <p className="muted small">"계속"은 고정 현장근무의 근무지를 바꿉니다 (지난 날짜는 그대로).</p>
    </Sheet>
  )));

  const changeSite = async (d: Driver) => {
    const siteId = await pick.site();
    if (!siteId) return;
    const u = usualField(snap, d.id, date);
    const scope = u?.recurringId ? await askScope() : 'day';
    if (!scope) return;
    if (scope === 'keep' && u?.recurringId) {
      const vs = snap.recurring_field_versions.filter((v) => v.recurring_field_id === u.recurringId).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
      const v = versionOn(vs, date) ?? vs[vs.length - 1];
      const today = seoulToday();
      const start = date >= today ? date : today;
      store.commit(planFieldRecurringChange(snap, { recurringId: u.recurringId, startDate: start, today, fields: { weekdays: v.weekdays, site_id: siteId, task: v.task, vehicle_id: v.vehicle_id } }).mutations);
    }
    store.run((tx) => setDaySite(tx, date, d.id, siteId));
    store.toast(`${d.name} → ${siteName(siteId)}${scope === 'keep' ? ' (계속)' : ''}`);
  };
  const editTask = async (d: Driver, cur: string) => {
    const t = await pick.memo(cur, '업무');
    if (t === null) return;
    store.run((tx) => {
      setStaffWorking(tx, date, d.id);
      for (const f of tx.list('field_assignments').filter((f) => f.date === date && f.staff_id === d.id && !f.is_off)) saveFieldAssignment(tx, { ...f, task: t });
    });
  };
  const editVehicle = async (d: Driver) => {
    const v = await pick.anyVehicle();
    if (v === undefined) return;
    store.run((tx) => {
      setStaffWorking(tx, date, d.id);
      const f = tx.list('field_assignments').find((f) => f.date === date && f.staff_id === d.id && !f.is_off);
      if (f) saveFieldAssignment(tx, { ...f, vehicle_id: v });
    });
  };
  const openPerson = (id: string) => staff && sheet.open((close) => <FieldPersonSheet date={date} staffId={id} close={close} />);
  const addPerson = async () => {
    const id = await pick.staff(date);
    if (id) openPerson(id);
  };
  const setOff = (d: Driver, off: boolean) => store.run((tx) => (off ? setDayOff(tx, date, d.id, true) : setStaffWorking(tx, date, d.id)));

  let lastZone = '';
  return (
    <div className="field-people">
      {people.map(({ d, mine, off, weekly }) => {
        const z = driverZone(d);
        const head = z !== lastZone ? <h3 key={`h-${z}`} style={{ margin: '12px 4px 4px' }}>{ZONE_LABEL[z]}</h3> : null;
        lastZone = z;
        const f = mine[0];
        return [
          head,
          <div key={d.id} className={`fp-row${off ? ' off' : ''}`}>
            <div className="row" style={{ gap: 8 }}>
              <b className="grow" style={{ fontSize: 18, cursor: staff ? 'pointer' : 'default' }} onClick={() => openPerson(d.id)}>{d.name} <span className="muted small">{d.staff_type}</span>{staff && <span className="muted small"> ✎</span>}</b>
              <div className="seg fp-seg">
                <button className={off ? '' : 'on'} disabled={!staff} onClick={() => off && setOff(d, false)}>근무</button>
                <button className={off ? 'on off' : ''} disabled={!staff} onClick={() => !off && setOff(d, true)}>휴무</button>
              </div>
            </div>
            {off ? (
              <div className="muted small" style={{ marginTop: 4 }}>{weekly ? '매주 고정 휴무 · "근무"를 누르면 이 날만 출근' : '이 날 휴무'}</div>
            ) : (
              <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <button className="chip fp-chip" disabled={!staff} onClick={() => void changeSite(d)}>📍 {siteName(f?.site_id ?? null) || '근무지'}</button>
                <button className="chip fp-chip grow" style={{ justifyContent: 'flex-start' }} disabled={!staff} onClick={() => void editTask(d, f?.task ?? '')}>{f?.task || '업무'}</button>
                <button className="chip fp-chip" disabled={!staff} onClick={() => void editVehicle(d)}>🚚 {f?.vehicle_id ? vehicleNo(snap, f.vehicle_id) : '차량'}</button>
                {mine.length > 1 && <span className="muted small">외 {mine.length - 1}곳</span>}
              </div>
            )}
          </div>,
        ];
      })}
      {!people.length && <p className="muted">현장 직원이 없습니다. 차량·설정 › 기사 에서 구분을 "현장"으로 등록하세요.</p>}
      {staff && (
        <>
          <button style={{ width: '100%', marginTop: 8, minHeight: 50 }} onClick={() => void addPerson()}>＋ 사람 추가 (기사·알바도 현장근무로)</button>
          <p className="muted small">이름을 누르면 근무지·업무·차량·휴무를 이 날만 / 기간 / 계속으로 바꿀 수 있습니다.</p>
        </>
      )}
    </div>
  );
}
