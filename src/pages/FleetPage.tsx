// 차량·기사·선박·정비·현장근무 등록
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  activeRepair, newId, planCreateFieldRecurring, planFieldRecurringChange, planFieldRecurringEnd,
  versionOn, weekdaysLabel, fixedOffDays, planStaffFixedOff, LEAVE_REASONS, cancelLeave, leaveRanges, setLeave,
  ON_CALL_SHIFT, SHIFT_PRESETS, driverGroup, guessDriverZone, type Driver, type Ship, type Vehicle, type VehicleType, type Weekday, type Zone,
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
      <Editable label="정렬 순서" value={cur.sort_order} type="number" onSave={s('sort_order', true)} />
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

/** 고정 휴무일 저장: 근무 요일 + 고정 현장근무 요일을 오늘부터 함께 맞춘다 */
function saveFixedOff(d: Driver, off: Weekday[]) {
  const r = planStaffFixedOff(store.getState().snap, { staffId: d.id, off, today: seoulToday() });
  store.commit(r.mutations);
  if (r.recurringChanged) store.toast(`${d.name} 고정 현장근무도 오늘부터 이 요일로 맞췄습니다`);
}

/** 고정 휴무일 (매주): 누른 요일 = 휴무 */
function OffDaysField({ d }: { d: Driver }) {
  const off = fixedOffDays(d);
  return (
    <label className="field">
      <span>고정 휴무일 (매주) {off.length ? <b style={{ color: 'var(--red)' }}>{weekdaysLabel(off)}</b> : <span className="muted">없음 · 매일 근무</span>}</span>
      <WeekdayChips value={off} onChange={(w) => {
        if (w.length >= 7) return store.toast('모든 요일을 휴무로 할 수 없습니다. 원할 때만 나오면 근무조를 "알바"로 하세요.', 'warn');
        saveFixedOff(d, w as Weekday[]);
      }} />
    </label>
  );
}

/** 직원·기사 전체 고정 휴무일 한 표에서 고치기 */
function OffDaysTable({ close }: { close: () => void }) {
  const snap = useSnap();
  const order: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
  const L = ['일', '월', '화', '수', '목', '금', '토'];
  const list = [...snap.drivers].filter((d) => d.shift !== ON_CALL_SHIFT)
    .sort((a, b) => (b.zone ?? guessDriverZone(b)).localeCompare(a.zone ?? guessDriverZone(a)) || a.staff_type.localeCompare(b.staff_type, 'ko') || driverGroup(a).localeCompare(driverGroup(b), 'ko', { numeric: true }) || a.name.localeCompare(b.name, 'ko'));
  const toggle = (d: Driver, w: Weekday) => {
    const off = fixedOffDays(d);
    const next = off.includes(w) ? off.filter((x) => x !== w) : [...off, w];
    if (next.length >= 7) return store.toast('모든 요일을 휴무로 할 수 없습니다', 'warn');
    saveFixedOff(d, next);
  };
  return (
    <Sheet title="고정 휴무일 (매주)" onClose={close} footer={<button className="primary" onClick={close}>닫기</button>}>
      <p className="muted small">칸을 누르면 그 요일이 매주 휴무(빨강)로 바뀝니다. 바로 저장됩니다. 알바는 정해진 근무일이 없어 빠져 있습니다.</p>
      <table className="simple offdays">
        <thead><tr><th>이름</th>{order.map((w) => <th key={w} style={{ color: w === 0 ? 'var(--red)' : w === 6 ? 'var(--blue)' : undefined }}>{L[w]}</th>)}</tr></thead>
        <tbody>
          {list.map((d) => {
            const off = fixedOffDays(d);
            return (
              <tr key={d.id}>
                <td><b>{d.name}</b><div className="muted" style={{ fontSize: 11 }}>{ZONE_LABEL[d.zone ?? guessDriverZone(d)]} · {d.staff_type === '기사' ? driverGroup(d) : d.staff_type}</div></td>
                {order.map((w) => (
                  <td key={w} className={off.includes(w) ? 'off' : ''} role="button" aria-label={`${d.name} ${L[w]}요일`} onClick={() => toggle(d, w)}>
                    {off.includes(w) ? '휴' : ''}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Sheet>
  );
}

/** 휴무 기간 등록 (휴가·병가 등): 그 기간 배차·현장근무에서 빠짐 */
function LeaveCard({ staffId }: { staffId: string }) {
  const snap = useSnap();
  const today = seoulToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState<string>('휴가');
  const ranges = leaveRanges(snap, staffId, today);
  const add = () => {
    let r = { days: 0, cleared: 0 };
    store.run((tx) => { r = setLeave(tx, { staffId, from, to, reason }); });
    store.toast(`휴무 ${r.days}일 등록${r.cleared ? ` · 이미 배차된 ${r.cleared}건은 기사를 비웠습니다` : ''}`);
  };
  const days = from && to ? Math.abs(Math.round((Date.parse(to) - Date.parse(from)) / 86400000)) + 1 : 0;
  return (
    <div className="card">
      <b>휴무 기간 등록</b> <span className="muted small">(그 기간 배차·현장근무 선택 목록에서 빠짐)</span>
      <div className="row" style={{ marginTop: 6 }}>
        <label className="field grow"><span>시작</span><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></label>
        <label className="field grow"><span>끝</span><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
        {LEAVE_REASONS.map((x) => <button key={x} className={`chip ${reason === x ? 'on' : ''}`} onClick={() => setReason(x)}>{x}</button>)}
      </div>
      <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={add}>휴무 등록 ({days}일)</button>
      {ranges.length > 0 && <div style={{ marginTop: 10 }}><b className="small">예정된 휴무</b></div>}
      {ranges.map((r) => (
        <div key={r.from} className="row" style={{ minHeight: 44 }}>
          <span className="grow">{fmtDate(r.from)}{r.to !== r.from ? ` ~ ${fmtDate(r.to)}` : ''} <span className="badge warn">{r.reason}</span></span>
          <button className="ghost" onClick={() => confirm('이 휴무를 취소할까요?') && store.run((tx) => cancelLeave(tx, { staffId, from: r.from, to: r.to }))}>취소</button>
        </div>
      ))}
    </div>
  );
}

/** 사람 고르고 → 휴무 기간 등록 */
function LeaveSheet({ close }: { close: () => void }) {
  const snap = useSnap();
  const [id, setId] = useState<string | null>(null);
  const person = snap.drivers.find((x) => x.id === id);
  return (
    <Sheet title={person ? `${person.name} 휴무 등록` : '휴무 등록 · 누구?'} onClose={close} footer={<button onClick={close}>닫기</button>}>
      {person ? <LeaveCard staffId={person.id} /> : (
        <div>
          {[...snap.drivers].sort((a, b) => a.staff_type.localeCompare(b.staff_type, 'ko') || a.name.localeCompare(b.name, 'ko')).map((x) => (
            <div key={x.id} className="list-item" onClick={() => setId(x.id)}><b className="grow">{x.name}</b><span className="muted small">{x.staff_type}</span></div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function DriverSheet({ d, close }: { d: Driver; close: () => void }) {
  const snap = useSnap();
  const cur = snap.drivers.find((x) => x.id === d.id) ?? d;
  const save = (p: Partial<Driver>) => store.run((tx) => (tx.get('drivers', d.id) ? tx.update('drivers', d.id, p) : tx.insert('drivers', { ...d, ...p })));
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
        <OffDaysField d={cur} />
      )}
      <Editable label="근무 지역" value={cur.zone ?? guessDriverZone(cur)} options={[{ value: 'jeju', label: '제주' }, { value: 'land', label: '육지' }]} onSave={(v) => save({ zone: v as Zone })} />
      <TeamField value={cur.team ?? ''} onSave={(v) => save({ team: v })} />
      <Editable label="소속" value={cur.affiliation} onSave={(v) => save({ affiliation: v })} />
      <Editable label="비고" value={cur.memo ?? ''} placeholder="예: 대형면허, 야간 가능, 주 3일만" multiline onSave={(v) => save({ memo: v })} />
      <LeaveCard staffId={d.id} />
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
          {staff && <button style={{ width: '100%', marginTop: 8 }} onClick={() => sheet.open((c) => <LeaveSheet close={c} />)}>🏖 휴무 기간 등록 (휴가·병가)</button>}
          {staff && <button style={{ width: '100%', marginTop: 8 }} onClick={() => sheet.open((c) => <OffDaysTable close={c} />)}>📅 고정 휴무일 한번에 보기·수정</button>}
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
                              <div className="muted small">{d.shift === ON_CALL_SHIFT ? '원할 때만 출근' : fixedOffDays(d).length ? <>휴무 <b style={{ color: 'var(--red)' }}>{weekdaysLabel(fixedOffDays(d))}</b></> : '매일 근무'} {d.phone}</div>
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
            {s.route !== 'both' && <span className="badge">{s.route === 'up' ? '제주 출발만' : '육지 출발만'}</span>}
            {s.arrival_day_offset !== 1 && <span className="badge warn">+{s.arrival_day_offset}일 도착</span>}
            {staff && <span className="muted">수정 ›</span>}
          </div>
          <div className="small">출발: 제주 <b>{s.departs_at || '-'}</b>
            {(s.port_times ?? []).map((p) => <span key={p.port}> · {p.port} <b>{p.time || '-'}</b></span>)}
          </div>
        </div>
      ))}
    </>
  );
}

/** 한 사람 고정 휴무일 고치기 (현장 설정에서) */
function OffSheet({ staffId, close }: { staffId: string; close: () => void }) {
  const snap = useSnap();
  const d = snap.drivers.find((x) => x.id === staffId);
  if (!d) return null;
  return (
    <Sheet title={`${d.name} 휴무 수정`} onClose={close} footer={<button className="primary" onClick={close}>닫기</button>}>
      <OffDaysField d={d} />
      <p className="muted small">누르면 바로 저장됩니다. 고정 현장근무도 오늘부터 휴무 요일을 빼고 다시 만들어집니다 (지난 날짜·직접 고친 줄은 그대로). 하루만 쉬는 날은 배차 화면 › 현장근무 탭에서 "＋ 휴무 지정"을 쓰세요.</p>
    </Sheet>
  );
}

function FieldSetupPanel() {
  const snap = useSnap();
  const sheet = useSheet();
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
    // 근무지 (닫으면 그대로)
    const site = (await pick.site()) ?? v.site_id;
    const task = prompt('업무', v.task);
    if (task === null) return;
    const vid = await pick.anyVehicle();
    const d = await pick.date('적용 시작일 (이전 날짜는 그대로)', today, today);
    if (!d) return;
    const r = planFieldRecurringChange(snap, { recurringId: recId, startDate: d, today, fields: { weekdays: v.weekdays, site_id: site, task, vehicle_id: vid === undefined ? v.vehicle_id : vid } });
    store.commit(r.mutations);
    store.toast(`${fmtDate(d)}부터 변경${r.keptManual ? ` · 직접 수정 ${r.keptManual}건 유지됨` : ''}`);
  };
  const add = async () => {
    const staffId = await pick.staff(today);
    if (!staffId) return;
    const site = await pick.site();
    const task = prompt('업무') ?? '';
    const vid = await pick.anyVehicle();
    const wd = snap.drivers.find((d) => d.id === staffId)?.work_days ?? [];
    store.commit(planCreateFieldRecurring(snap, { staff_id: staffId, today, startDate: today, fields: { weekdays: wd.length ? wd : [1, 2, 3, 4, 5, 6], site_id: site, task, vehicle_id: vid ?? null } }).mutations);
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
        const person = snap.drivers.find((d) => d.id === r.staff_id);
        return (
          <div key={r.id} className="card">
            <div className="row"><b className="grow">{driverName(snap, r.staff_id)}</b>{!r.active && <span className="badge">종료</span>}</div>
            {v && <div className="muted">{snap.field_sites.find((s) => s.id === v.site_id)?.name} · {v.task} {v.vehicle_id && `· ${vehicleNo(snap, v.vehicle_id)}`} · {weekdaysLabel(v.weekdays)}</div>}
            {person && <div className="small">휴무 {fixedOffDays(person).length ? <b style={{ color: 'var(--red)' }}>{weekdaysLabel(fixedOffDays(person))}</b> : <span className="muted">없음</span>}</div>}
            {staff && r.active && <div className="row" style={{ marginTop: 6 }}>
              <button className="grow" onClick={() => change(r.id, 'change')}>변경</button>
              {person && <button className="grow" onClick={() => sheet.open((c) => <OffSheet staffId={person.id} close={c} />)}>휴무 수정</button>}
              <button className="grow danger" onClick={() => change(r.id, 'end')}>종료</button>
            </div>}
          </div>
        );
      })}
      {staff && <button className="primary" style={{ width: '100%' }} onClick={add}>＋ 고정 근무 등록</button>}
    </>
  );
}
