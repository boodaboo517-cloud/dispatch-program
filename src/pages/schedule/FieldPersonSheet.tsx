// 현장근무 한 사람 일정 바꾸기·추가: 근무/휴무, 근무지, 업무, 차량을 이 날만 / 기간 / 이 날부터 계속으로
import { useState } from 'react';
import {
  addDays, fixedOffDays, planCreateFieldRecurring, planFieldRecurringChange, setStaffDay, setStaffRange, usualField, versionOn, weekdayOf,
  workDaysFromOff, type Weekday,
} from '../../domain/index.ts';
import { store } from '../../data/store.ts';
import { fmtDate, seoulToday } from '../../lib/time.ts';
import { useSnap } from '../../ui/hooks.ts';
import { vehicleNo } from '../../ui/labels.ts';
import { PhraseChips } from '../../ui/Phrases.tsx';
import { usePickers } from '../../ui/pickers.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

type Scope = 'day' | 'range' | 'keep';
const ALL: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export function FieldPersonSheet({ date, staffId, close }: { date: string; staffId: string; close: () => void }) {
  const snap = useSnap();
  const pick = usePickers();
  const person = snap.drivers.find((d) => d.id === staffId);
  const today = seoulToday();
  const cur = snap.field_assignments.find((f) => f.date === date && f.staff_id === staffId && !f.is_off);
  const isOff = snap.field_assignments.some((f) => f.date === date && f.staff_id === staffId && f.is_off);
  const usual = usualField(snap, staffId, date);
  const [off, setOff] = useState(isOff);
  const [site, setSite] = useState<string | null>(cur?.site_id ?? usual?.site_id ?? null);
  const [task, setTask] = useState(cur?.task ?? usual?.task ?? '');
  const [vehicle, setVehicle] = useState<string | null>(cur?.vehicle_id ?? usual?.vehicle_id ?? null);
  const [scope, setScope] = useState<Scope>('day');
  const [end, setEnd] = useState(addDays(date, 6));
  const [skipOff, setSkipOff] = useState(true);
  const weeklyOff = person ? fixedOffDays(person) : [];
  const sites = [...snap.field_sites].sort((a, b) => a.sort_order - b.sort_order);
  const canKeep = !off && date >= today;

  const save = () => {
    const plan = { off, site_id: site, task: task.trim(), vehicle_id: vehicle };
    if (scope === 'day') {
      store.run((tx) => setStaffDay(tx, date, staffId, plan));
      store.toast(`${person?.name} ${fmtDate(date)} ${off ? '휴무' : '저장'}`);
    } else if (scope === 'range') {
      let n = 0;
      store.run((tx) => { n = setStaffRange(tx, { staffId, from: date, to: end, plan, skipDays: skipOff ? weeklyOff : [] }); });
      store.toast(`${person?.name} ${fmtDate(date)} ~ ${fmtDate(end)} ${n}일 ${off ? '휴무' : '저장'}`);
    } else {
      // 이 날부터 계속: 고정 근무를 바꾸거나 새로 만든다 (지난 날짜는 그대로)
      const fields = (weekdays: Weekday[]) => ({ weekdays, site_id: site, task: task.trim(), vehicle_id: vehicle });
      if (usual?.recurringId) {
        const vs = snap.recurring_field_versions.filter((v) => v.recurring_field_id === usual.recurringId).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
        const v = versionOn(vs, date) ?? vs[vs.length - 1];
        store.commit(planFieldRecurringChange(snap, { recurringId: usual.recurringId, startDate: date, today, fields: fields(v?.weekdays ?? ALL) }).mutations);
      } else {
        const work = person ? workDaysFromOff(weeklyOff) : [];
        store.commit(planCreateFieldRecurring(snap, { staff_id: staffId, startDate: date, today, fields: fields(work.length ? work : ALL) }).mutations);
      }
      store.run((tx) => setStaffDay(tx, date, staffId, plan));
      store.toast(`${person?.name} ${fmtDate(date)}부터 계속 적용`);
    }
    close();
  };

  return (
    <Sheet title={`${person?.name ?? ''} · ${fmtDate(date)} 현장근무`} onClose={close} footer={<button className="primary" onClick={save}>저장</button>}>
      <div className="seg fp-seg" style={{ width: '100%', marginBottom: 10 }}>
        <button className={`grow ${!off ? 'on' : ''}`} style={{ flex: 1 }} onClick={() => setOff(false)}>근무</button>
        <button className={`grow ${off ? 'on off' : ''}`} style={{ flex: 1 }} onClick={() => { setOff(true); if (scope === 'keep') setScope('day'); }}>휴무</button>
      </div>

      {!off && (
        <>
          <div className="field">
            <span>근무지</span>
            <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
              {sites.map((s) => <button key={s.id} className={`chip ${site === s.id ? 'on' : ''}`} style={{ minHeight: 42 }} onClick={() => setSite(s.id)}>{s.name}</button>)}
            </div>
          </div>
          <label className="field"><span>업무</span><input value={task} placeholder="예: 배송지원, 상차 지원" onChange={(e) => setTask(e.target.value)} /></label>
          <PhraseChips settingKey="task_phrases" label="자주 쓰는 업무" onPick={(ph) => setTask(ph)} />
          <div className="field">
            <span>지급 차량</span>
            <button className="chip fp-chip" onClick={async () => { const v = await pick.anyVehicle(); if (v !== undefined) setVehicle(v); }}>🚚 {vehicle ? vehicleNo(snap, vehicle) : '없음 · 고르기'}</button>
          </div>
        </>
      )}

      <div className="field">
        <span>적용</span>
        <div className="seg fp-seg" style={{ width: '100%' }}>
          <button className={`grow ${scope === 'day' ? 'on' : ''}`} style={{ flex: 1 }} onClick={() => setScope('day')}>이 날만</button>
          <button className={`grow ${scope === 'range' ? 'on' : ''}`} style={{ flex: 1 }} onClick={() => setScope('range')}>기간</button>
          <button className={`grow ${scope === 'keep' ? 'on' : ''}`} style={{ flex: 1 }} disabled={!canKeep} onClick={() => setScope('keep')}>계속</button>
        </div>
      </div>
      {scope === 'range' && (
        <div className="card" style={{ background: '#f8fafc' }}>
          <div className="row" style={{ alignItems: 'center', gap: 6 }}>
            <span>{fmtDate(date)} ~</span>
            <input type="date" value={end} min={date} onChange={(e) => e.target.value && setEnd(e.target.value)} style={{ width: 'auto' }} />
          </div>
          {!off && weeklyOff.length > 0 && (
            <label className="row" style={{ gap: 6, marginTop: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={skipOff} onChange={(e) => setSkipOff(e.target.checked)} style={{ width: 'auto' }} />
              <span className="small">매주 쉬는 날({weeklyOff.map((w) => '일월화수목금토'[w]).join('·')}) 빼기</span>
            </label>
          )}
          <p className="muted small" style={{ margin: '6px 0 0' }}>기간 안의 날짜마다 {off ? '휴무로' : '위 근무지·업무·차량으로'} 저장합니다. 고정 근무는 바뀌지 않습니다.</p>
        </div>
      )}
      {scope === 'keep' && (
        <p className="muted small">{usual?.recurringId ? '고정 근무를' : '고정 근무를 새로 만들어'} {fmtDate(date)}({'일월화수목금토'[weekdayOf(date)]})부터 이 근무지·업무·차량으로 계속 표시합니다. 지난 날짜와 직접 고친 날은 그대로입니다.</p>
      )}
      {!canKeep && !off && <p className="muted small">"계속"은 오늘 이후 날짜에서만 고를 수 있습니다.</p>}
    </Sheet>
  );
}
