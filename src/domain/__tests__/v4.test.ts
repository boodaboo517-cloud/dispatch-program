import { beforeEach, describe, expect, it } from 'vitest';
import { buildBoard, lastStart, missingDriver, needsDriver, setDriverSeq, setRowDriver, setRowHelper, setRowStart, startText } from '../board.ts';
import { blankOrder, saveOrder, workText } from '../orders.ts';
import { Tx, applyMutations } from '../tx.ts';
import { blankField, planCreateFieldRecurring, saveFieldAssignment } from '../fieldwork.ts';
import { ON_CALL_SHIFT, repairSnapshot, type Driver, type Weekday } from '../types.ts';
import { assignedDriverIds, fixedOffDays, offByZone, planStaffFixedOff, weeklyOffOn, workDaysFromOff } from '../workforce.ts';
import { baseSnapshot, resetIds } from './fixtures.ts';

beforeEach(resetIds);
const D = '2026-10-20';

function setup() {
  const s = baseSnapshot();
  s.vehicles = s.vehicles.map((v, i) => ({ ...v, home_zone: 'jeju', sort_order: i })); // 9915, 9914, 8948 순
  const tx = new Tx(s);
  for (const v of ['v9915', 'v9914', 'v8948']) {
    saveOrder(tx, blankOrder({ date: D, zone: 'jeju', kind: 'unload', vehicle_id: v, client_id: 'c-sin' }));
    saveOrder(tx, blankOrder({ date: D, zone: 'jeju', kind: 'load', vehicle_id: v, client_id: 'c-dm' }));
  }
  return tx;
}
const row = (tx: Tx, v: string) => buildBoard(tx.result(), D).rows.find((r) => r.vehicle.id === v && !r.secondary)!;
const set = (tx: Tx, v: string, d: string | null, side?: 'unload' | 'load') =>
  setRowDriver(tx, { date: D, vehicle_id: v, zone: 'jeju', driver_id: d, side });

describe('오전·오후 기사', () => {
  it('기본은 오전 기사가 오후도 맡는다', () => {
    const tx = setup();
    set(tx, 'v9915', 'dA');
    const r = row(tx, 'v9915');
    expect([r.driverId, r.loadDriverId]).toEqual(['dA', 'dA']);
    expect([...r.unloads, ...r.loads].map((o) => o.driver_id)).toEqual(['dA', 'dA']);
  });
  it('오후만 다른 기사로 바꾸면 상차 오더만 그 기사로', () => {
    const tx = setup();
    set(tx, 'v9915', 'dA');
    set(tx, 'v9915', 'dB', 'load');
    const r = row(tx, 'v9915');
    expect([r.driverId, r.loadDriverId]).toEqual(['dA', 'dB']);
    expect(r.unloads[0].driver_id).toBe('dA');
    expect(r.loads[0].driver_id).toBe('dB');
  });
  it('오전 기사를 바꿔도 따로 정한 오후 기사는 그대로', () => {
    const tx = setup();
    set(tx, 'v9915', 'dA');
    set(tx, 'v9915', 'dB', 'load');
    set(tx, 'v9915', 'dC');
    const r = row(tx, 'v9915');
    expect([r.driverId, r.loadDriverId]).toEqual(['dC', 'dB']);
  });
  it('오후 기사를 오전 기사와 같게 하면 "같음"으로 돌아간다', () => {
    const tx = setup();
    set(tx, 'v9915', 'dA');
    set(tx, 'v9915', 'dB', 'load');
    set(tx, 'v9915', 'dA', 'load');
    expect(tx.list('vehicle_days')[0].load_driver_id).toBeNull();
    expect(row(tx, 'v9915').loadDriverId).toBe('dA');
  });
});

describe('기사 처리 순서 (1번차·2번차…)', () => {
  it('한 대만 맡으면 번호 없음', () => {
    const tx = setup();
    set(tx, 'v9915', 'dA');
    expect(row(tx, 'v9915').unloadSeq).toBeNull();
  });
  it('같은 기사를 두 번째·세 번째 차량에 지정하면 ①②③ 자동', () => {
    const tx = setup();
    set(tx, 'v9915', 'dA');
    set(tx, 'v9914', 'dA');
    set(tx, 'v8948', 'dA');
    expect(['v9915', 'v9914', 'v8948'].map((v) => row(tx, v).unloadSeq)).toEqual([1, 2, 3]);
    expect(row(tx, 'v9915').loadSeq).toBe(1); // 오후도 같은 기사 → 같은 순서
  });
  it('오전은 다른 차, 오후에 이 차를 맡으면 오후 칸에 다음 번호', () => {
    const tx = setup();
    set(tx, 'v9915', 'dA');
    set(tx, 'v9914', 'dB');
    set(tx, 'v9914', 'dA', 'load');
    const a = row(tx, 'v9915');
    const b = row(tx, 'v9914');
    expect(a.unloadSeq).toBe(1);
    expect([b.driverId, b.unloadSeq, b.loadDriverId, b.loadSeq]).toEqual(['dB', null, 'dA', 2]);
  });
  it('기사를 빼서 한 대만 남으면 번호를 지운다', () => {
    const tx = setup();
    set(tx, 'v9915', 'dA');
    set(tx, 'v9914', 'dA');
    set(tx, 'v9914', 'dB');
    expect(row(tx, 'v9915').unloadSeq).toBeNull();
    expect(row(tx, 'v9914').unloadSeq).toBeNull();
  });
  it('순서를 직접 고칠 수 있다', () => {
    const tx = setup();
    set(tx, 'v9915', 'dA');
    set(tx, 'v9914', 'dA');
    setDriverSeq(tx, { date: D, vehicle_id: 'v9915', zone: 'jeju', side: 'unload', seq: 2 });
    setDriverSeq(tx, { date: D, vehicle_id: 'v9914', zone: 'jeju', side: 'unload', seq: 1 });
    expect([row(tx, 'v9915').unloadSeq, row(tx, 'v9914').unloadSeq]).toEqual([2, 1]);
  });
});

describe('고정 휴무일 (매주)', () => {
  const drv = (p: Partial<Driver>): Driver => ({ id: 'dA', name: '김기사', phone: '', work_days: [], shift: '', affiliation: '', staff_type: '기사', memo: '', ...p });
  it('근무 요일의 나머지가 휴무, 매일 근무·알바는 휴무 없음', () => {
    expect(fixedOffDays(drv({ work_days: [1, 2, 3, 4, 5, 6] }))).toEqual([0]);
    expect(fixedOffDays(drv({ work_days: [] }))).toEqual([]);
    expect(fixedOffDays(drv({ shift: ON_CALL_SHIFT, work_days: [1] }))).toEqual([]);
  });
  it('휴무 요일 → 근무 요일, 휴무 없음 = 매일 근무', () => {
    expect(workDaysFromOff([0, 6])).toEqual([1, 2, 3, 4, 5]);
    expect(workDaysFromOff([])).toEqual([]);
  });
  it('일정표 휴무 목록: 고정 휴무 요일이고 그날 배차·근무 기록이 없는 사람', () => {
    const s = baseSnapshot();
    s.drivers = [drv({ id: 'dA', work_days: [1, 2, 3, 4, 5, 6] }), drv({ id: 'dB', name: '박기사', work_days: [1, 2, 3, 4, 5, 6] })];
    const sunday = '2026-10-25';
    const tx = new Tx(s);
    setRowDriver(tx, { date: sunday, vehicle_id: 'v9915', zone: 'land', driver_id: 'dB' });
    expect(weeklyOffOn(tx.result(), sunday).map((d) => d.id)).toEqual(['dA']);
    expect(weeklyOffOn(tx.result(), '2026-10-26')).toEqual([]);
  });
});

describe('한 차량 기사 2명 (선탑·지원)', () => {
  it('동승 기사와 역할이 줄에 나오고, 그날 배차된 사람으로 잡힌다', () => {
    const tx = setup();
    set(tx, 'v9915', 'dA');
    setRowHelper(tx, { date: D, vehicle_id: 'v9915', zone: 'jeju', driver_id: 'dB', role: '선탑' });
    const r = row(tx, 'v9915');
    expect([r.driverId, r.helperId, r.helperRole]).toEqual(['dA', 'dB', '선탑']);
    expect(assignedDriverIds(tx.result(), D).has('dB')).toBe(true);
    // 동승은 처리 순서 번호를 만들지 않는다
    expect(r.unloadSeq).toBeNull();
  });
  it('해제하면 역할도 지운다', () => {
    const tx = setup();
    setRowHelper(tx, { date: D, vehicle_id: 'v9915', zone: 'jeju', driver_id: 'dB', role: '지원' });
    setRowHelper(tx, { date: D, vehicle_id: 'v9915', zone: 'jeju', driver_id: null, role: '' });
    expect([row(tx, 'v9915').helperId, row(tx, 'v9915').helperRole]).toEqual([null, '']);
  });
});

describe('출근 시간·장소', () => {
  it('저장하고, 다음 날 입력 때는 같은 차량의 최근 값을 기본으로', () => {
    const tx = setup();
    setRowStart(tx, { date: D, vehicle_id: 'v9915', zone: 'jeju', time: '07:00', place: '부두' });
    const r = row(tx, 'v9915');
    expect(startText(r)).toBe('07:00 부두');
    expect(lastStart(tx.result(), 'v9915', '2026-10-21')).toEqual({ time: '07:00', place: '부두' });
    expect(lastStart(tx.result(), 'v9914', '2026-10-21')).toBeNull();
  });
});

describe('미배치 (차량은 있는데 기사 없음)', () => {
  it('오더가 있는 쪽만 미배치, 오후 기사가 따로 없으면 오전 기사로 채워짐', () => {
    const tx = setup();
    let r = row(tx, 'v9915');
    expect([missingDriver(r, 'unload'), missingDriver(r, 'load'), needsDriver(r)]).toEqual([true, true, true]);
    set(tx, 'v9915', 'dA');
    r = row(tx, 'v9915');
    expect(needsDriver(r)).toBe(false);
  });
});

describe('휴무 육지·제주 구분', () => {
  it('근무 지역별로 나누고, 지역을 안 정했으면 근무조·소속으로 추정', () => {
    const s = baseSnapshot();
    const base = { phone: '', work_days: [1, 2, 3, 4, 5, 6] as Weekday[], affiliation: '', staff_type: '기사' as const, memo: '' };
    s.drivers = [
      { ...base, id: 'd1', name: '가', shift: '', zone: 'jeju' },
      { ...base, id: 'd2', name: '나', shift: '부산상주' },
      { ...base, id: 'd3', name: '다', shift: '', zone: 'land' },
    ];
    const off = offByZone(s, '2026-10-25');
    expect(off.jeju.map((d) => d.id)).toEqual(['d1']);
    expect(off.land.map((d) => d.id)).toEqual(['d2', 'd3']);
  });
});

describe('상·하차 세부', () => {
  it('"08:40 하차 · 막걸리공병 하차지원"', () => {
    expect(workText({ kind: 'unload', work_time: '08:40', work_detail: '막걸리공병 하차지원' })).toBe('08:40 하차 · 막걸리공병 하차지원');
    expect(workText({ kind: 'load', work_time: '14:00', work_detail: '' })).toBe('14:00 상차');
    expect(workText({ kind: 'load' })).toBe('');
  });
});

describe('배차 못 한 짐 날짜 변경', () => {
  it('미배차 상차를 다른 날로 옮기면 연결된 반대편 하차도 같이 옮겨진다', () => {
    const tx = new Tx(baseSnapshot());
    const load = saveOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: 'c-dm', departure_ship: '제이엘' }));
    expect(buildBoard(tx.result(), D).waiting.land.map((o) => o.id)).toEqual([load.id]);
    saveOrder(tx, { ...tx.get('daily_orders', load.id)!, date: '2026-10-22' });
    const moved = tx.get('daily_orders', load.id)!;
    const unload = tx.list('daily_orders').find((o) => o.linked_from_id === load.id)!;
    expect(moved.date).toBe('2026-10-22');
    expect(unload.date).toBe('2026-10-23');
    expect(buildBoard(tx.result(), D).waiting.land).toEqual([]);
    expect(buildBoard(tx.result(), '2026-10-22').waiting.land.map((o) => o.id)).toEqual([load.id]);
  });
});

describe('현장근무자 휴무', () => {
  it('고정 현장근무가 있는데 그날 현장·차량 어디에도 없으면 휴무로 표시', () => {
    const s = baseSnapshot();
    const base = { phone: '', work_days: [] as Weekday[], shift: '', affiliation: '', memo: '', zone: 'jeju' as const };
    s.drivers = [{ ...base, id: 'f1', name: '현장A', staff_type: '현장' }, { ...base, id: 'f2', name: '현장B', staff_type: '현장' }];
    s.recurring_field_work = [
      { id: 'r1', staff_id: 'f1', active: true, generated_until: '2026-12-31' },
      { id: 'r2', staff_id: 'f2', active: true, generated_until: '2026-12-31' },
    ];
    const tx = new Tx(s);
    saveFieldAssignment(tx, blankField({ date: D, staff_id: 'f1', task: '경리' }));
    expect(offByZone(tx.result(), D).jeju.map((d) => d.id)).toEqual(['f2']);
    // 생성 기간 밖(먼 미래)은 추정하지 않음
    expect(offByZone(tx.result(), '2027-02-01').jeju).toEqual([]);
  });
});

describe('예전 버전 데이터 보정', () => {
  it('빠진 표·null 배열·빈 행을 채워서 화면이 깨지지 않게', () => {
    const raw = { drivers: [{ id: 'd1', name: null, work_days: null, shift: null }, null], ships: [{ id: 's1', name: '제이엘', port_times: null }], vehicles: undefined } as never;
    const s = repairSnapshot(raw);
    expect(s.drivers).toEqual([expect.objectContaining({ id: 'd1', name: '', work_days: [], shift: '' })]);
    expect(s.ships[0].port_times).toEqual([]);
    expect(s.vehicles).toEqual([]);
    expect(s.recurring_field_work).toEqual([]);
    expect(() => offByZone(s, D)).not.toThrow();
  });
});

describe('현장근무자 휴무 수정', () => {
  it('고정 휴무일을 바꾸면 고정 현장근무도 오늘부터 그 요일을 빼고, 일정표 현장 휴무에 나온다', () => {
    const s = baseSnapshot();
    s.drivers = [{ id: 'f1', name: '현장A', phone: '', work_days: [1, 2, 3, 4, 5, 6], shift: '', affiliation: '', staff_type: '현장', memo: '', zone: 'jeju' }];
    const today = '2026-10-19'; // 월
    let snap = applyMutations(s, planCreateFieldRecurring(s, { staff_id: 'f1', today, startDate: today, fields: { weekdays: [1, 2, 3, 4, 5, 6], site_id: null, task: '출고', vehicle_id: null } }).mutations);
    const wed = '2026-10-21';
    expect(snap.field_assignments.some((f) => f.date === wed && f.staff_id === 'f1')).toBe(true);
    const r = planStaffFixedOff(snap, { staffId: 'f1', off: [0, 3], today });
    snap = applyMutations(snap, r.mutations);
    expect(r.recurringChanged).toBe(1);
    expect(snap.drivers[0].work_days).toEqual([1, 2, 4, 5, 6]);
    expect(snap.field_assignments.some((f) => f.date === wed && f.staff_id === 'f1')).toBe(false);
    expect(snap.field_assignments.some((f) => f.date === '2026-10-22' && f.staff_id === 'f1')).toBe(true);
    expect(offByZone(snap, wed).jeju.map((d) => d.id)).toEqual(['f1']);
    expect(offByZone(snap, '2026-10-22').jeju).toEqual([]);
  });
});
