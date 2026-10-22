// 차량·기사·선박·정비·현장근무 등록
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  activeRepair, checkOdometer, newId, oilStatus, planCreateFieldRecurring, planFieldRecurringChange, planFieldRecurringEnd,
  setDayOff, versionOn, weekdaysLabel,
  ON_CALL_SHIFT, SHIFT_PRESETS, driverGroup, type Driver, type Ship, type Vehicle, type VehicleType, type Weekday, type Zone,
} from '../domain/index.ts';
import { store } from '../data/store.ts';
import { fmtDate, seoulToday } from '../lib/time.ts';
import { Editable } from '../ui/Editable.tsx';
import { useRole, useSnap } from '../ui/hooks.ts';
import { ZONE_LABEL, driverName, vehicleNo } from '../ui/labels.ts';
import { WeekdayChips } from '../ui/Picker.tsx';
import { usePickers } from '../ui/pickers.tsx';
import { Sheet, useSheet } from '../ui/Sheet.tsx';
import { ShipEditSheet, blankShip } from '../ui/ShipEditSheet.tsx';
import { AttendancePanel } from './AttendancePanel.tsx';
import { MaintenancePanel } from './MaintenancePanel.tsx';

type Tab = 'vehicles' | 'drivers' | 'attendance' | 'ships' | 'maintenance' | 'field';
const TYPES: VehicleType[] = ['5톤', '통윙', '통윙2냉', '1톤', '승용'];

export function OilBar({ v }: { v: Vehicle }) {
  const snap = useSnap();
  const o = oilStatus(snap, v, seoulToday());
  if (o.level === 'unknown') return <div className="muted small">엔진오일: 교환 기록·주행거리 없음</div>;
  return (
    <div>
      <div className="row small"><span className="grow">엔진오일 {o.usedKm!.toLocaleString()} / {o.intervalKm.toLocaleString()}km</span>
        <span style={{ color: o.level === 'over' ? 'var(--red)' : undefined, fontWeight: 700 }}>{o.remainingKm! >= 0 ? `${o.remainingKm!.toLocaleString()}km 남음` : `${(-o.remainingKm!).toLocaleString()}km 초과`}</span></div>
      <div className={`bar ${o.level}`}><i style={{ width: `${Math.min(100, o.ratio! * 100)}%` }} /></div>
      {o.expectedDate && <div className="muted small">예상 교환일 {fmtDate(o.expectedDate)}</div>}
    </div>
  );
}

export function OdometerInput({ vehicleId }: { vehicleId: string }) {
  const snap = useSnap();
  const [km, setKm] = useState('');
  const last = snap.odometer_logs.filter((l) => l.vehicle_id === vehicleId).sort((a, b) => a.date.localeCompare(b.date)).pop();
  const submit = () => {
    const n = Number(km.replace(/,/g, ''));
    if (!n) return;
    const today = seoulToday();
    const warn = checkOdometer(snap.odometer_logs, vehicleId, today, n);
    if (warn.length && !confirm(`확인해 주세요:\n${warn.join('\n')}\n\n그래도 저장할까요?`)) return;
    const existing = snap.odometer_logs.find((l) => l.vehicle_id === vehicleId && l.date === today);
    store.run((tx) => (existing ? tx.update('odometer_logs', existing.id, { km: n }) : tx.insert('odometer_logs', { id: newId(), vehicle_id: vehicleId, date: today, km: n })));
    setKm('');
    store.toast('주행거리 저장');
  };
  return (
    <div>
      <div className="row">
        <input inputMode="numeric" placeholder={last ? `마지막 ${last.km.toLocaleString()}km (${fmtDate(last.date)})` : '현재 주행거리 km'} value={km} onChange={(e) => setKm(e.target.value)} />
        <button className="primary" onClick={submit}>입력</button>
      </div>
    </div>
  );
}

function VehicleSheet({ v, close }: { v: Vehicle; close: () => void }) {
  const snap = useSnap();
  const cur = snap.vehicles.find((x) => x.id === v.id) ?? v;
  const save = (p: Partial<Vehicle>) => store.run((tx) => (tx.get('vehicles', v.id) ? tx.update('vehicles', v.id, p) : tx.insert('vehicles', { ...v, ...p })));
  const s = (k: keyof Vehicle, num = false) => (val: string) => save({ [k]: num ? (val === '' ? null : Number(val)) : val } as Partial<Vehicle>);
  return (
    <Sheet title={`차량 ${cur.short_no}`} onClose={close}>
      <Editable label="차량번호" value={cur.plate} onSave={s('plate')} />
      <Editable label="표시 4자리" value={cur.short_no} onSave={s('short_no')} />
      <Editable label="차종" value={cur.vehicle_type} options={TYPES.map((t) => ({ value: t, label: t }))} onSave={s('vehicle_type')} />
      <Editable label="구분" value={cur.usage} options={[{ value: '배차', label: '배차' }, { value: '업무용', label: '업무용 (현장근무 지급)' }]} onSave={s('usage')} />
      <Editable label="소속" value={cur.ownership} options={[{ value: '자차', label: '자차' }, { value: '개인', label: '개인(용차)' }]} onSave={s('ownership')} />
      <Editable label="상태" value={cur.status} options={['운행', '정비', '휴차'].map((t) => ({ value: t, label: t }))} onSave={s('status')} />
      <Editable label="현재 위치" value={cur.home_zone ?? ''} options={[{ value: '', label: '미정' }, { value: 'land', label: '육지' }, { value: 'jeju', label: '제주' }]} onSave={(x) => save({ home_zone: (x || null) as Vehicle['home_zone'] })} />
      <Editable label="오일 주기 km" value={cur.oil_interval_km} type="number" placeholder="기본값 사용" onSave={s('oil_interval_km', true)} />
      <Editable label="정렬 순서" value={cur.sort_order} type="number" onSave={s('sort_order', true)} />
      <div className="card"><b>주행거리</b><OdometerInput vehicleId={v.id} /><div style={{ marginTop: 8 }}><OilBar v={cur} /></div></div>
      <p className="muted small">정비 기간은 "정비" 탭에서 등록하면 그 기간 동안 일정표에 수리로 자동 표시됩니다. 현재 위치는 처음 등록할 때만 쓰이고, 이후는 선박 이동으로 자동 결정됩니다.</p>
      <button className="danger" style={{ width: '100%' }} onClick={() => { if (confirm('차량을 삭제할까요?')) { store.run((tx) => tx.remove('vehicles', v.id)); close(); } }}>차량 삭제</button>
    </Sheet>
  );
}

/** 팀: 직접 쓰거나 이미 있는 팀을 눌러 고른다 (자동 저장) */
function TeamField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const snap = useSnap();
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const teams = [...new Set(snap.drivers.map((d) => d.team?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  const commit = (x: string) => {
    setV(x);
    if (x.trim() !== value) onSave(x.trim());
  };
  return (
    <div className="editable" style={{ flexWrap: 'wrap' }}>
      <span className="k">팀</span>
      <input style={{ flex: 1, minWidth: 120 }} value={v} placeholder="예: 1팀, 부산팀 (비우면 근무조로 묶음)" onChange={(e) => setV(e.target.value)} onBlur={() => commit(v)} onKeyDown={(e) => e.key === 'Enter' && commit(v)} />
      {teams.length > 0 && (
        <div className="row wrap" style={{ width: '100%', marginTop: 4 }}>
          {teams.map((t) => <button key={t} type="button" className={`chip${t === value ? ' on' : ''}`} onClick={() => commit(t)}>{t}</button>)}
        </div>
      )}
    </div>
  );
}

function DriverSheet({ d, close }: { d: Driver; close: () => void }) {
  const snap = useSnap();
  const cur = snap.drivers.find((x) => x.id === d.id) ?? d;
  const [offDate, setOffDate] = useState(seoulToday());
  const save = (p: Partial<Driver>) => store.run((tx) => (tx.get('drivers', d.id) ? tx.update('drivers', d.id, p) : tx.insert('drivers', { ...d, ...p })));
  const offs = snap.field_assignments.filter((f) => f.staff_id === d.id && f.is_off && f.date >= seoulToday()).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Sheet title={cur.name} onClose={close}>
      <Editable label="이름" value={cur.name} onSave={(v) => save({ name: v })} />
      <Editable label="연락처" value={cur.phone} type="tel" onSave={(v) => save({ phone: v })} />
      <Editable label="구분" value={cur.staff_type} options={['기사', '현장', '사무'].map((x) => ({ value: x, label: x }))} onSave={(v) => save({ staff_type: v as Driver['staff_type'] })} />
      <Editable label="근무조" value={cur.shift} options={['', ...Object.keys(SHIFT_PRESETS), '부산상주', '서울상주'].map((x) => ({ value: x, label: x === ON_CALL_SHIFT ? '알바 (원할 때만 출근)' : x || '-' }))} onSave={(v) => {
        save({ shift: v, ...(SHIFT_PRESETS[v] ? { work_days: SHIFT_PRESETS[v] } : {}) });
      }} />
      {cur.shift === ON_CALL_SHIFT ? (
        <p className="muted small">알바는 정해진 근무일이 없습니다. 출근하는 날 일정표의 기사 칸이나 근무현황에서 근무형태를 넣으면 그날 근무로 잡힙니다.</p>
      ) : (
        <label className="field"><span>근무 요일</span><WeekdayChips value={cur.work_days} onChange={(w) => save({ work_days: w as Weekday[] })} /></label>
      )}
      <TeamField value={cur.team ?? ''} onSave={(v) => save({ team: v })} />
      <Editable label="소속" value={cur.affiliation} onSave={(v) => save({ affiliation: v })} />
      <Editable label="비고" value={cur.memo ?? ''} placeholder="예: 대형면허, 야간 가능, 주 3일만" multiline onSave={(v) => save({ memo: v })} />
      <div className="card">
        <b>휴무 지정</b> <span className="muted small">(배차·현장근무 선택 목록에서 빠짐)</span>
        <div className="row"><input type="date" value={offDate} onChange={(e) => setOffDate(e.target.value)} /><button onClick={() => store.run((tx) => setDayOff(tx, offDate, d.id, true))}>휴무</button></div>
        {offs.map((f) => <div key={f.id} className="row"><span className="grow">{fmtDate(f.date)}</span><button className="ghost" onClick={() => store.run((tx) => setDayOff(tx, f.date, d.id, false))}>취소</button></div>)}
      </div>
      <button className="danger" style={{ width: '100%' }} onClick={() => { if (confirm('삭제할까요?')) { store.run((tx) => tx.remove('drivers', d.id)); close(); } }}>삭제</button>
    </Sheet>
  );
}

export function FleetPage() {
  const params = useParams();
  const nav = useNavigate();
  const tab = (params.tab as Tab) ?? 'vehicles';
  const snap = useSnap();
  const sheet = useSheet();
  const { staff } = useRole();
  const today = seoulToday();

  const tabs: [Tab, string][] = [['vehicles', '차량'], ['drivers', '기사'], ['attendance', '근무현황'], ['ships', '선박'], ['maintenance', '정비'], ['field', '현장']];
  const blankVehicle = (): Vehicle => ({ id: newId(), plate: '', short_no: '', vehicle_type: '5톤', usage: '배차', ownership: '자차', default_driver_id: null, status: '운행', home_zone: null, sort_order: snap.vehicles.length, oil_interval_km: null });
  const blankDriver = (): Driver => ({ id: newId(), name: '', phone: '', work_days: [], shift: '', affiliation: '', staff_type: '기사', memo: '' });

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="tabs">{tabs.map(([t, l]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => nav(`/fleet/${t}`)}>{l}</button>)}</div>

      {tab === 'vehicles' && (
        <>
          {staff && <button className="primary" style={{ width: '100%' }} onClick={() => {
            const plate = prompt('차량번호 (예: 제주90바1234)')?.trim();
            if (!plate) return;
            const zone = confirm('지금 제주에 있습니까? (취소 = 육지)') ? 'jeju' : 'land';
            const v = { ...blankVehicle(), plate, short_no: plate.replace(/\D/g, '').slice(-4), home_zone: zone as Vehicle['home_zone'] };
            store.run((tx) => tx.insert('vehicles', v));
            sheet.open((c) => <VehicleSheet v={v} close={c} />);
          }}>＋ 차량 등록</button>}
          {[...snap.vehicles].sort((a, b) => a.plate.localeCompare(b.plate, 'ko', { numeric: true })).map((v) => {
            const repair = activeRepair(snap.maintenance_records, v.id, today);
            const status = repair ? '정비' : v.status;
            return (
              <div key={v.id} className="card" onClick={() => staff && sheet.open((c) => <VehicleSheet v={v} close={c} />)} style={{ cursor: 'pointer' }}>
                <div className="row">
                  <b style={{ fontSize: 24 }}>{v.short_no}</b>
                  <span className="grow muted">{v.plate} · {v.vehicle_type} · {v.usage} · {v.ownership}</span>
                  <span className={`badge ${status === '운행' ? 'ok' : status === '정비' ? 'red' : 'warn'}`}>{status}</span>
                </div>
                <div className="muted small">등록 위치 {v.home_zone ? ZONE_LABEL[v.home_zone] : '미정'}{repair ? ` · ${repair.kind} ${repair.shop}` : ''}</div>
                {v.usage === '배차' && <OilBar v={v} />}
              </div>
            );
          })}
        </>
      )}

      {tab === 'drivers' && (
        <>
          {staff && <button className="primary" style={{ width: '100%' }} onClick={() => {
            const name = prompt('이름')?.trim();
            if (!name) return;
            const d = { ...blankDriver(), name };
            store.run((tx) => tx.insert('drivers', d));
            sheet.open((c) => <DriverSheet d={d} close={c} />);
          }}>＋ 기사·직원 등록</button>}
          {(['기사', '현장', '사무'] as const).map((type) => {
            const list = snap.drivers.filter((d) => d.staff_type === type);
            const groups = type === '기사' ? [...new Set(list.map(driverGroup))].sort((a, b) => (a === '팀 없음' ? 1 : b === '팀 없음' ? -1 : a.localeCompare(b, 'ko', { numeric: true }))) : [''];
            return (
              <div key={type}>
                <h3>{type}</h3>
                {groups.map((g) => (
                  <div key={g}>
                    {g && <div className="muted small" style={{ margin: '8px 4px 2px', fontWeight: 700 }}>{g}</div>}
                    <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 2 }}>
                      {list.filter((d) => !g || driverGroup(d) === g).sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((d) => {
                        const off = snap.field_assignments.some((f) => f.date === today && f.staff_id === d.id && f.is_off);
                        return (
                          <div key={d.id} className="list-item" onClick={() => staff && sheet.open((c) => <DriverSheet d={d} close={c} />)}>
                            <div className="grow"><b>{d.name}</b> <span className="muted">{d.shift} {d.affiliation}</span>
                              <div className="muted small">{d.shift === ON_CALL_SHIFT ? '원할 때만 출근' : weekdaysLabel(d.work_days)} {d.phone}</div>
                              {d.memo && <div className="small" style={{ color: '#92400e' }}>📝 {d.memo}</div>}
                            </div>
                            {off && <span className="badge warn">오늘 휴무</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </>
      )}

      {tab === 'attendance' && <AttendancePanel />}
      {tab === 'ships' && <ShipsPanel />}
      {tab === 'maintenance' && <MaintenancePanel />}
      {tab === 'field' && <FieldSetupPanel />}
    </div>
  );
}

function ShipsPanel() {
  const snap = useSnap();
  const sheet = useSheet();
  const { staff } = useRole();
  const ships = [...snap.ships].sort((a, b) => a.name.localeCompare(b.name, 'ko') || (a.departs_at || '99').localeCompare(b.departs_at || '99'));
  const open = (s: Ship) => staff && sheet.open((c) => <ShipEditSheet ship={s} close={c} />);
  return (
    <>
      <p className="muted">선박을 누르면 수정합니다. "도착일 차이"는 상차 → 반대 지역 하차 자동 입력 날짜에 쓰입니다.</p>
      {staff && <button className="primary" style={{ width: '100%' }} onClick={() => open(blankShip(snap.ships.length))}>＋ 선박 추가</button>}
      {ships.map((s) => (
        <div key={s.id} className="card" onClick={() => open(s)} style={{ cursor: staff ? 'pointer' : 'default' }}>
          <div className="row">
            <b className="grow" style={{ fontSize: 19 }}>{s.name}</b>
            {s.route !== 'both' && <span className="badge">{s.route === 'up' ? '상행만' : '하행만'}</span>}
            {s.arrival_day_offset !== 1 && <span className="badge warn">+{s.arrival_day_offset}일 도착</span>}
            {staff && <span className="muted">수정 ›</span>}
          </div>
          <div className="small">제주 출발(상행) <b>{s.departs_at || '-'}</b></div>
          {(s.port_times ?? []).length > 0 && (
            <div className="small">하행: {(s.port_times ?? []).map((p) => `${p.port} ${p.time || '-'}`).join(' · ')}</div>
          )}
        </div>
      ))}
    </>
  );
}

function FieldSetupPanel() {
  const snap = useSnap();
  const { staff } = useRole();
  const pick = usePickers();
  const today = seoulToday();
  const change = async (recId: string, mode: 'change' | 'end') => {
    const v = versionOn(snap.recurring_field_versions.filter((x) => x.recurring_field_id === recId), today);
    if (!v) return;
    if (mode === 'end') {
      const d = await pick.date('마지막 근무일', today, today);
      if (!d) return;
      store.commit(planFieldRecurringEnd(snap, { recurringId: recId, endDate: d, today }).mutations);
      return;
    }
    const task = prompt('업무', v.task);
    if (task === null) return;
    const vid = await pick.anyVehicle();
    const d = await pick.date('적용 시작일 (이전 날짜는 그대로)', today, today);
    if (!d) return;
    const r = planFieldRecurringChange(snap, { recurringId: recId, startDate: d, today, fields: { weekdays: v.weekdays, site_id: v.site_id, task, vehicle_id: vid === undefined ? v.vehicle_id : vid } });
    store.commit(r.mutations);
    store.toast(`${fmtDate(d)}부터 변경${r.keptManual ? ` · 직접 수정 ${r.keptManual}건 유지됨` : ''}`);
  };
  const add = async () => {
    const staffId = await pick.staff(today);
    if (!staffId) return;
    const site = await pick.site();
    const task = prompt('업무') ?? '';
    const vid = await pick.anyVehicle();
    store.commit(planCreateFieldRecurring(snap, { staff_id: staffId, today, startDate: today, fields: { weekdays: [1, 2, 3, 4, 5, 6], site_id: site, task, vehicle_id: vid ?? null } }).mutations);
  };
  return (
    <>
      <h3>근무지</h3>
      <div className="card">
        {snap.field_sites.map((s) => (
          <div key={s.id} className="row">
            <div className="grow"><Editable label="근무지" value={s.name} onSave={staff ? (v) => store.run((tx) => tx.update('field_sites', s.id, { name: v })) : undefined} /></div>
            <select aria-label="일정표 위치" value={s.zone ?? ''} disabled={!staff} style={{ width: 'auto' }}
              onChange={(e) => store.run((tx) => tx.update('field_sites', s.id, { zone: (e.target.value || null) as Zone | null }))}>
              <option value="">표시 위치 없음</option><option value="land">육지 표</option><option value="jeju">제주 표</option>
            </select>
            {staff && <button className="ghost" onClick={() => confirm('삭제할까요?') && store.run((tx) => tx.remove('field_sites', s.id))}>✕</button>}
          </div>
        ))}
        {staff && <button onClick={() => { const n = prompt('근무지 이름')?.trim(); if (n) store.run((tx) => tx.insert('field_sites', { id: newId(), name: n, sort_order: snap.field_sites.length, zone: 'jeju' })); }}>＋ 근무지</button>}
      </div>
      <h3>고정 근무 (매일 자동 표시 · 변경 시 지난 날짜는 그대로)</h3>
      {snap.recurring_field_work.map((r) => {
        const v = versionOn(snap.recurring_field_versions.filter((x) => x.recurring_field_id === r.id), today);
        return (
          <div key={r.id} className="card">
            <div className="row"><b className="grow">{driverName(snap, r.staff_id)}</b>{!r.active && <span className="badge">종료</span>}</div>
            {v && <div className="muted">{snap.field_sites.find((s) => s.id === v.site_id)?.name} · {v.task} {v.vehicle_id && `· ${vehicleNo(snap, v.vehicle_id)}`} · {weekdaysLabel(v.weekdays)}</div>}
            {staff && r.active && <div className="row" style={{ marginTop: 6 }}><button className="grow" onClick={() => change(r.id, 'change')}>변경</button><button className="grow danger" onClick={() => change(r.id, 'end')}>종료</button></div>}
          </div>
        );
      })}
      {staff && <button className="primary" style={{ width: '100%' }} onClick={add}>＋ 고정 근무 등록</button>}
    </>
  );
}
