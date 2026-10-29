// 현장근무 사람별 입력: 기사 일정처럼 한 사람 = 한 줄 · 이름 | 근무지 | 지급차량 | 오전 | 오후 (칸을 누르면 바로 고침)
import { useState } from 'react';
import {
  ON_CALL_SHIFT, driverZone, fieldDayOf, offByZone, planFieldRecurringChange, setFieldDay, setFieldHalf, setStaffWorking,
  usualField, versionOn, type Driver, type FieldAssignment,
} from '../../domain/index.ts';
import { store } from '../../data/store.ts';
import { seoulToday } from '../../lib/time.ts';
import { useBoard, useRole, useSnap } from '../../ui/hooks.ts';
import { ZONE_LABEL, vehicleNo } from '../../ui/labels.ts';
import { PhraseChips } from '../../ui/Phrases.tsx';
import { usePickers } from '../../ui/pickers.tsx';
import { Sheet, useSheet } from '../../ui/Sheet.tsx';
import { FieldPersonSheet } from './FieldPersonSheet.tsx';

type Half = 'am' | 'pm';
const HALF_LABEL: Record<Half | 'all', string> = { all: '종일', am: '오전', pm: '오후' };

/** 업무 칸 고치기: 종일(오전·오후 같음) 또는 오전 / 오후만 · 그 시간 근무지 · 그 시간 근무 없음 */
function HalfSheet({ date, d, half: start, cur, close }: { date: string; d: Driver; half: Half | 'all'; cur: FieldAssignment | null; close: () => void }) {
  const snap = useSnap();
  const [half, setHalf] = useState<Half | 'all'>(start);
  const [task, setTask] = useState(cur?.task ?? '');
  const [site, setSite] = useState<string | null>(cur?.site_id ?? null);
  const sites = [...snap.field_sites].sort((a, b) => a.sort_order - b.sort_order);
  const save = (none = false) => {
    store.run((tx) => (half === 'all'
      ? setFieldDay(tx, date, d.id, { task: task.trim(), site_id: site })
      : setFieldHalf(tx, date, d.id, half, none ? { none: true } : { task: task.trim(), site_id: site })));
    close();
  };
  return (
    <Sheet title={`${d.name} · ${HALF_LABEL[half]}`} onClose={close} footer={<>
      {half !== 'all' && <button onClick={() => save(true)}>이 시간 근무 없음</button>}
      <button className="primary" onClick={() => save()}>저장</button>
    </>}>
      <div className="seg fp-seg" style={{ width: '100%', marginBottom: 8 }}>
        {(['all', 'am', 'pm'] as const).map((h) => <button key={h} className={`grow ${half === h ? 'on' : ''}`} style={{ flex: 1 }} onClick={() => setHalf(h)}>{h === 'all' ? '종일' : `${HALF_LABEL[h]}만`}</button>)}
      </div>
      <label className="field"><span>{HALF_LABEL[half]} 업무</span>
        <input autoFocus value={task} placeholder="예: 배송지원, 상차 지원" onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </label>
      <PhraseChips settingKey="task_phrases" label="자주 쓰는 업무" onPick={(ph) => setTask(ph)} />
      <div className="field">
        <span>{HALF_LABEL[half]} 근무지</span>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
          {sites.map((s) => <button key={s.id} className={`chip ${site === s.id ? 'on' : ''}`} style={{ minHeight: 42 }} onClick={() => setSite(s.id)}>{s.name}</button>)}
        </div>
      </div>
      <p className="muted small">오전·오후가 다르면 두 칸에 따로 나오고, 같아지면 다시 종일로 합쳐집니다.</p>
    </Sheet>
  );
}

export function FieldPeople({ date }: { date: string }) {
  const snap = useSnap();
  const board = useBoard(date);
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
      const day = fieldDayOf(rows, d.id, date);
      const dayOff = rows.some((f) => f.staff_id === d.id && f.is_off);
      const off = dayOff || (!day.rows.length && offIds.has(d.id));
      return { d, day, off, weekly: off && !dayOff };
    })
    .sort((a, b) => driverZone(b.d).localeCompare(driverZone(a.d)) || Number(a.off) - Number(b.off)
      || siteName(a.day.site_id).localeCompare(siteName(b.day.site_id), 'ko') || a.d.name.localeCompare(b.d.name, 'ko'));

  /** 그 시간 기사로 배차된 차량 (현장 직원이 오전·오후에 차량 배차를 받는 경우) */
  const drivingIn = (id: string, half: Half) => board.rows
    .filter((r) => (half === 'am' ? r.driverId === id && (r.unloads.length || r.driverId !== r.loadDriverId) : r.loadDriverId === id && (r.loads.length || r.driverId !== r.loadDriverId)))
    .map((r) => r.vehicle.short_no);

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
    store.run((tx) => setFieldDay(tx, date, d.id, { site_id: siteId }));
    store.toast(`${d.name} → ${siteName(siteId)}${scope === 'keep' ? ' (계속)' : ''}`);
  };
  const editVehicle = async (d: Driver) => {
    const v = await pick.anyVehicle();
    if (v !== undefined) store.run((tx) => setFieldDay(tx, date, d.id, { vehicle_id: v }));
  };
  const editHalf = (d: Driver, half: Half | 'all', cur: FieldAssignment | null) =>
    staff && sheet.open((close) => <HalfSheet date={date} d={d} half={half} cur={cur} close={close} />);
  const openPerson = (id: string) => staff && sheet.open((close) => <FieldPersonSheet date={date} staffId={id} close={close} />);
  const addPerson = async () => {
    const id = await pick.staff(date);
    if (id) openPerson(id);
  };
  const toWork = (d: Driver) => {
    if (!staff || !confirm(`${d.name} ${date.slice(5).replace('-', '/')} 근무로 바꿀까요?`)) return;
    store.run((tx) => setStaffWorking(tx, date, d.id));
  };

  const halfCell = (d: Driver, day: ReturnType<typeof fieldDayOf>, half: Half) => {
    const f = half === 'am' ? day.am : day.pm;
    const cars = drivingIn(d.id, half);
    const otherSite = f && f.site_id !== day.site_id ? siteName(f.site_id) : '';
    return (
      <button className={`fg-cell fg-half${f ? '' : ' empty'}`} disabled={!staff} onClick={() => editHalf(d, half, f)}>
        {otherSite && <span className="fg-site2">📍{otherSite}</span>}
        {f ? <span className="fg-task">{f.task || <span className="muted">업무 ＋</span>}</span> : !cars.length && <span className="muted">-</span>}
        {cars.map((c) => <span key={c} className="fg-car">🚚 {c} 배차</span>)}
      </button>
    );
  };

  let lastZone = '';
  return (
    <div className="field-grid">
      <div className="fg-row fg-head">
        <span>이름</span><span>근무지</span><span>지급차량</span><span>오전</span><span>오후</span>
      </div>
      {people.map(({ d, day, off, weekly }) => {
        const z = driverZone(d);
        const head = z !== lastZone ? <div key={`h-${z}`} className="fg-zone">{ZONE_LABEL[z]}</div> : null;
        lastZone = z;
        return [
          head,
          <div key={d.id} className={`fg-row${off ? ' off' : ''}`}>
            <button className="fg-cell fg-name" disabled={!staff} onClick={() => openPerson(d.id)}>
              <b>{d.name}</b><span className="muted small">{d.staff_type}</span>
            </button>
            {off ? (
              <button className="fg-cell fg-off" disabled={!staff} onClick={() => toWork(d)}>
                휴무 <span className="muted small">{weekly ? '(매주 고정)' : ''} · 누르면 근무로</span>
              </button>
            ) : (
              <>
                <button className={`fg-cell${day.site_id ? '' : ' empty'}`} disabled={!staff} onClick={() => void changeSite(d)}>{siteName(day.site_id) || '＋'}</button>
                <button className={`fg-cell${day.vehicle_id ? '' : ' empty'}`} disabled={!staff} onClick={() => void editVehicle(d)}>{day.vehicle_id ? vehicleNo(snap, day.vehicle_id) : '＋'}</button>
                {day.am && day.am === day.pm && !drivingIn(d.id, 'am').length && !drivingIn(d.id, 'pm').length ? (
                  // 종일: 오전·오후 한 칸으로
                  <button className="fg-cell fg-half fg-whole" disabled={!staff} onClick={() => editHalf(d, 'all', day.am)}>
                    <span className="fg-task">{day.am.task || <span className="muted">업무 ＋</span>}</span>
                  </button>
                ) : (
                  <>
                    {halfCell(d, day, 'am')}
                    {halfCell(d, day, 'pm')}
                  </>
                )}
              </>
            )}
          </div>,
        ];
      })}
      {!people.length && <p className="muted">현장 직원이 없습니다. 관리 › 기사 에서 구분을 "현장"으로 등록하세요.</p>}
      {staff && (
        <>
          <button style={{ width: '100%', marginTop: 8, minHeight: 50 }} onClick={() => void addPerson()}>＋ 사람 추가 (기사·알바도 현장근무로)</button>
          <p className="muted small">칸을 누르면 바로 고칩니다. 이름을 누르면 휴무 · 기간 · 계속(고정 근무)으로 정할 수 있습니다.</p>
        </>
      )}
    </div>
  );
}
