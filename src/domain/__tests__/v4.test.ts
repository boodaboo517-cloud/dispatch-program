import { beforeEach, describe, expect, it } from 'vitest';
import { buildBoard, lastStart, missingDriver, needsDriver, setRowNote, setDriverSeq, setRowDriver, setRowHelper, setRowStart, startText } from '../board.ts';
import { blankOrder, repairShipLinks, saveOrder, setRowShip, workText } from '../orders.ts';
import { Tx, applyMutations } from '../tx.ts';
import { copyOrder, createOrder, splitPerVehicle } from '../actions.ts';
import { planCreateRecurring, planRecurringChange } from '../recurring.ts';
import { blankField, planCreateFieldRecurring, saveFieldAssignment, setDayOff, setDaySite, setStaffWorking } from '../fieldwork.ts';
import { ON_CALL_SHIFT, repairSnapshot, type Driver, type Weekday } from '../types.ts';
import { assignedDriverIds, cancelLeave, fixedOffDays, leaveRanges, offByZone, planStaffFixedOff, setLeave, weeklyOffOn, workDaysFromOff } from '../workforce.ts';
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

describe('대 단위 2대 이상 → 1대씩 나눠 배차', () => {
  it('3대 상차 → 1대씩 3건, 첫 건만 차량 유지, 나머지는 배차 대기, 반대편 하차도 3건', () => {
    const tx = new Tx(baseSnapshot());
    const load = createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: 'c-dm', quantity: 3, unit: '대', vehicle_id: 'v9915', departure_ship: '제이엘' }));
    const ids = splitPerVehicle(tx, load.id);
    expect(ids).toHaveLength(3);
    const loads = ids.map((id) => tx.get('daily_orders', id)!);
    expect(loads.map((o) => [o.quantity, o.unit, o.vehicle_id])).toEqual([[1, '대', 'v9915'], [1, '대', null], [1, '대', null]]);
    const unloads = tx.list('daily_orders').filter((o) => o.kind === 'unload');
    expect(unloads).toHaveLength(3);
    expect(unloads.every((u) => u.quantity === 1)).toBe(true);
    expect(buildBoard(tx.result(), D).waiting.land).toHaveLength(2);
  });
  it('1대·파렛트는 나누지 않음', () => {
    const tx = new Tx(baseSnapshot());
    const a = createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'unload', client_id: 'c-dm', quantity: 1, unit: '대' }));
    const b = createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'unload', client_id: 'c-dm', quantity: 10, unit: '파렛트' }));
    expect(splitPerVehicle(tx, a.id)).toEqual([a.id]);
    expect(splitPerVehicle(tx, b.id)).toEqual([b.id]);
    expect(tx.list('daily_orders')).toHaveLength(2);
  });
});

describe('반복 오더도 대당 자동 나누기', () => {
  const today = '2026-10-19';
  const make = () => planCreateRecurring(baseSnapshot(), {
    client_id: 'c-dm', product_id: null, zone: 'land', kind: 'load', startDate: today, today,
    fields: { weekdays: [1], quantity: 2, unit: '대', region: '', memo: '', vehicle_id: 'v9915', ship: '제이엘', ship_tag: '' },
  });
  it('생성할 때 날짜마다 1대씩 2건 (첫 건만 차량), 반대편 하차도 2건', () => {
    const snap = applyMutations(baseSnapshot(), make().mutations);
    const mon = snap.daily_orders.filter((o) => o.date === today && o.kind === 'load');
    expect(mon.map((o) => [o.quantity, o.vehicle_id, o.source])).toEqual([[1, 'v9915', 'recurring'], [1, null, 'recurring']]);
    expect(snap.daily_orders.filter((o) => o.date === '2026-10-20' && o.kind === 'unload')).toHaveLength(2);
  });
  it('반복 변경하면 나눈 건까지 함께 다시 만들어진다 (중복 없음)', () => {
    let snap = applyMutations(baseSnapshot(), make().mutations);
    const recId = snap.recurring_orders[0].id;
    snap = applyMutations(snap, planRecurringChange(snap, {
      recurringId: recId, startDate: today, today,
      fields: { weekdays: [1], quantity: 3, unit: '대', region: '', memo: '', vehicle_id: 'v9915', ship: '제이엘', ship_tag: '' },
    }).mutations);
    expect(snap.daily_orders.filter((o) => o.date === today && o.kind === 'load')).toHaveLength(3);
    expect(snap.daily_orders.filter((o) => o.date === '2026-10-26' && o.kind === 'load')).toHaveLength(3);
  });
});

describe('오더 복사', () => {
  it('다른 날로 복사: 내용·금액 그대로, 차량은 비움(배차 대기), 상차면 반대편 하차도 새로', () => {
    const tx = new Tx(baseSnapshot());
    const load = createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: 'c-dm', product_id: 'p-gam', quantity: 10, unit: '파렛트', vehicle_id: 'v9915', memo: '야간', departure_ship: '제이엘' }));
    const [id] = copyOrder(tx, load.id, { date: '2026-10-21', keepVehicle: false });
    const c = tx.get('daily_orders', id)!;
    expect([c.date, c.client_id, c.quantity, c.memo, c.vehicle_id, c.source]).toEqual(['2026-10-21', 'c-dm', 10, '야간', null, 'manual']);
    expect(tx.list('daily_orders').filter((o) => o.linked_from_id === id)).toHaveLength(1);
    expect(tx.list('order_revenue').filter((r) => r.order_id === id)).toHaveLength(1);
    expect(buildBoard(tx.result(), '2026-10-21').waiting.land.map((o) => o.id)).toEqual([id]);
  });
  it('차량도 같이 복사', () => {
    const tx = new Tx(baseSnapshot());
    const o = createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'unload', client_id: 'c-dm', vehicle_id: 'v9915', driver_id: 'dA' }));
    const [id] = copyOrder(tx, o.id, { date: D, keepVehicle: true });
    expect([tx.get('daily_orders', id)!.vehicle_id, tx.get('daily_orders', id)!.driver_id]).toEqual(['v9915', 'dA']);
  });
});

describe('현장근무자 근무·휴무·근무지 바꾸기', () => {
  const setupField = () => {
    const s = baseSnapshot();
    s.drivers = [{ id: 'f1', name: '현장A', phone: '', work_days: [1, 2, 3, 4, 5, 6], shift: '', affiliation: '', staff_type: '현장', memo: '', zone: 'jeju' }];
    s.field_sites = [{ id: 'site1', name: '본사', sort_order: 0, zone: 'jeju' }, { id: 'site2', name: '함덕', sort_order: 1, zone: 'jeju' }];
    return applyMutations(s, planCreateFieldRecurring(s, { staff_id: 'f1', today: '2026-10-19', startDate: '2026-10-19', fields: { weekdays: [1, 2, 3, 4, 5, 6], site_id: 'site1', task: '경리', vehicle_id: null } }).mutations);
  };
  it('휴무 → 그날 근무 줄 없어지고, 근무로 되돌리면 평소 근무지·업무로 다시', () => {
    const tx = new Tx(setupField());
    setDayOff(tx, D, 'f1', true);
    expect(tx.list('field_assignments').filter((f) => f.date === D).map((f) => f.is_off)).toEqual([true]);
    setStaffWorking(tx, D, 'f1');
    const rows = tx.list('field_assignments').filter((f) => f.date === D);
    expect(rows.map((f) => [f.is_off, f.site_id, f.task])).toEqual([[false, 'site1', '경리']]);
  });
  it('고정 휴무일(일요일)에도 "근무"로 그날만 출근', () => {
    const tx = new Tx(setupField());
    setStaffWorking(tx, '2026-10-25', 'f1');
    expect(tx.list('field_assignments').filter((f) => f.date === '2026-10-25').map((f) => f.site_id)).toEqual(['site1']);
    expect(offByZone(tx.result(), '2026-10-25').jeju).toEqual([]);
  });
  it('그날만 근무지 바꾸기 (고정 근무는 그대로, 다시 생성돼도 유지)', () => {
    const tx = new Tx(setupField());
    setDaySite(tx, D, 'f1', 'site2');
    expect(tx.list('field_assignments').find((f) => f.date === D && !f.is_off)!.site_id).toBe('site2');
    expect(tx.list('field_assignments').find((f) => f.date === '2026-10-21' && !f.is_off)!.site_id).toBe('site1');
  });
});

describe('휴무 기간 (휴가·병가)', () => {
  it('기간 매일 휴무, 이미 배차된 기사는 비우고, 연속 기간으로 묶어 보여 준다, 취소하면 원래대로', () => {
    const tx = setup();
    set(tx, 'v9915', 'dA');
    set(tx, 'v9914', 'dB');
    set(tx, 'v9914', 'dA', 'load');
    const r = setLeave(tx, { staffId: 'dA', from: D, to: '2026-10-22', reason: '휴가' });
    expect(r).toEqual({ days: 3, cleared: 2 });
    expect(row(tx, 'v9915').driverId).toBeNull();
    expect(row(tx, 'v9914').loadDriverId).toBe('dB');
    expect(tx.list('daily_orders').filter((o) => o.date === D && o.driver_id === 'dA')).toEqual([]);
    expect(leaveRanges(tx.result(), 'dA', D)).toEqual([{ from: D, to: '2026-10-22', reason: '휴가' }]);
    cancelLeave(tx, { staffId: 'dA', from: D, to: '2026-10-22' });
    expect(leaveRanges(tx.result(), 'dA', D)).toEqual([]);
  });
});

describe('선박 "대기" = 배 안 탐', () => {
  it('출발 선박이 대기면 다음 날도 같은 지역, 반대편 하차·도착 선박이 생기지 않는다', () => {
    const tx = new Tx(baseSnapshot());
    const load = createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: 'c-dm', vehicle_id: 'v9915', departure_ship: '대기' }));
    const next = buildBoard(tx.result(), '2026-10-21').rows.find((r) => r.vehicle.id === 'v9915')!;
    expect(next.zone).toBe('land');
    expect(next.arrivalShip).toBeNull();
    expect(tx.list('daily_orders').filter((o) => o.linked_from_id === load.id)).toEqual([]);
  });
  it('대기 → 실제 선박으로 바꾸면 그때 반대편 하차가 생기고 차량이 넘어간다', () => {
    const tx = new Tx(baseSnapshot());
    const load = createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: 'c-dm', vehicle_id: 'v9915', departure_ship: '대기' }));
    saveOrder(tx, { ...tx.get('daily_orders', load.id)!, departure_ship: '제이엘' });
    setRowShip(tx, { date: D, vehicle_id: 'v9915', zone: 'land', which: 'departure', ship: '제이엘', tag: '' });
    expect(tx.list('daily_orders').filter((o) => o.linked_from_id === load.id)).toHaveLength(1);
    expect(buildBoard(tx.result(), '2026-10-21').rows.find((r) => r.vehicle.id === 'v9915' && !r.secondary)!.zone).toBe('jeju');
  });
});

describe('선박 "익일선적" = 다음 날 선적, 그다음 날 도착', () => {
  it('다음 날은 같은 지역, 이틀 뒤 반대 지역 · 반대편 하차도 이틀 뒤', () => {
    const tx = new Tx(baseSnapshot());
    const load = createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: 'c-dm', vehicle_id: 'v9915', departure_ship: '익일선적' }));
    setRowShip(tx, { date: D, vehicle_id: 'v9915', zone: 'land', which: 'departure', ship: '익일선적', tag: '' });
    const zoneOn = (d: string) => buildBoard(tx.result(), d).rows.find((r) => r.vehicle.id === 'v9915' && !r.secondary)!.zone;
    expect(zoneOn('2026-10-21')).toBe('land');
    expect(zoneOn('2026-10-22')).toBe('jeju');
    expect(tx.list('daily_orders').find((o) => o.linked_from_id === load.id)!.date).toBe('2026-10-22');
  });
});

describe('대기 상차짐 [[ 상차짐 ]] 이어가기', () => {
  const D2 = '2026-10-21';
  const D3 = '2026-10-22';
  const start = () => {
    const tx = new Tx(baseSnapshot());
    const load = createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: 'c-dm', vehicle_id: 'v9915', departure_ship: '대기' }));
    setRowShip(tx, { date: D, vehicle_id: 'v9915', zone: 'land', which: 'departure', ship: '대기', tag: '' });
    return { tx, load };
  };
  const rowOn = (tx: Tx, d: string) => buildBoard(tx.result(), d).rows.find((r) => r.vehicle.id === 'v9915' && !r.secondary)!;
  it('다음 날 같은 지역 차량 줄에 상차짐으로 이어지고 공차가 아니다', () => {
    const { tx, load } = start();
    const r = rowOn(tx, D2);
    expect(r.zone).toBe('land');
    expect(r.carried.map((o) => o.id)).toEqual([load.id]);
    expect(r.status).toBe('');
  });
  it('다음 날 선박을 정하면 그 날 선적 → 그다음 날 반대편 하차·차량 이동, 이후엔 이어지지 않음', () => {
    const { tx, load } = start();
    setRowShip(tx, { date: D2, vehicle_id: 'v9915', zone: 'land', which: 'departure', ship: '제이엘', tag: '' });
    const o = tx.get('daily_orders', load.id)!;
    expect([o.departure_ship, o.ship_date]).toEqual(['제이엘', D2]);
    expect(tx.list('daily_orders').find((x) => x.linked_from_id === load.id)!.date).toBe(D3);
    expect(rowOn(tx, D2).zone).toBe('land');
    expect(rowOn(tx, D2).carried).toHaveLength(1);
    expect(rowOn(tx, D3).zone).toBe('jeju');
  });
  it('다음 날도 대기면 하루 더 이어진다', () => {
    const { tx, load } = start();
    setRowShip(tx, { date: D2, vehicle_id: 'v9915', zone: 'land', which: 'departure', ship: '대기', tag: '' });
    expect(rowOn(tx, D3).carried.map((x) => x.id)).toEqual([load.id]);
    expect(rowOn(tx, D3).zone).toBe('land');
  });
});

describe('예전에 저장된 대기·익일선적 짐 바로잡기', () => {
  it('대기인데 예전 규칙으로 반대편 하차가 남아 차량이 육지에 나오던 것을 바로잡는다', () => {
    const tx = new Tx(baseSnapshot());
    const load = createOrder(tx, blankOrder({ date: D, zone: 'jeju', kind: 'load', client_id: 'c-dm', vehicle_id: 'v9914', departure_ship: '제이엘' }));
    setRowShip(tx, { date: D, vehicle_id: 'v9914', zone: 'jeju', which: 'departure', ship: '제이엘', tag: '' });
    // 예전 버전처럼 선박만 "대기"로 바뀌고 연결 하차·도착 선박은 그대로 남은 상태
    tx.update('daily_orders', load.id, { departure_ship: '대기' });
    const vd = tx.list('vehicle_days').find((v) => v.date === D && v.vehicle_id === 'v9914')!;
    tx.update('vehicle_days', vd.id, { departure_ship: '대기' });
    const zoneNext = () => buildBoard(tx.result(), '2026-10-21').rows.find((r) => r.vehicle.id === 'v9914' && !r.secondary)!.zone;
    expect(zoneNext()).toBe('land'); // 고치기 전: 남은 하차 때문에 육지
    repairShipLinks(tx, D);
    expect(tx.list('daily_orders').filter((o) => o.linked_from_id === load.id)).toEqual([]);
    expect(zoneNext()).toBe('jeju');
  });
});

describe('선박 없는 상차 = 대기와 같음', () => {
  it('선박이 없으면 반대편 하차 없이 그 지역에 그대로, 다음 날 [[ 상차짐 ]], 선박을 정하면 그때 하차', () => {
    const tx = new Tx(baseSnapshot());
    const load = createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: 'c-dm', vehicle_id: 'v9915' }));
    expect(tx.list('daily_orders').filter((o) => o.linked_from_id === load.id)).toEqual([]);
    const r = buildBoard(tx.result(), '2026-10-21').rows.find((x) => x.vehicle.id === 'v9915' && !x.secondary)!;
    expect([r.zone, r.carried.map((o) => o.id)]).toEqual(['land', [load.id]]);
    setRowShip(tx, { date: '2026-10-21', vehicle_id: 'v9915', zone: 'land', which: 'departure', ship: '제이엘', tag: '' });
    expect(tx.list('daily_orders').find((o) => o.linked_from_id === load.id)!.date).toBe('2026-10-22');
  });
  it('당일 왕복은 선박 없어도 같은 날 하차', () => {
    const tx = new Tx(baseSnapshot());
    const load = createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: 'c-dm', vehicle_id: 'v9914', same_day: true }));
    expect(tx.list('daily_orders').find((o) => o.linked_from_id === load.id)!.date).toBe(D);
  });
});

describe('오전·오후 칸 비고만', () => {
  it('오더 없이 칸에 비고, 공차로 세지 않음, 빈 글자면 지움', () => {
    const tx = new Tx(baseSnapshot());
    setRowNote(tx, { date: D, vehicle_id: 'v9914', zone: 'jeju', kind: 'unload', note: '부두 대기 후 출고' });
    let r = buildBoard(tx.result(), D).rows.find((x) => x.vehicle.id === 'v9914')!;
    expect([r.unloadNote, r.status]).toEqual(['부두 대기 후 출고', '']);
    setRowNote(tx, { date: D, vehicle_id: 'v9914', zone: 'jeju', kind: 'unload', note: '' });
    r = buildBoard(tx.result(), D).rows.find((x) => x.vehicle.id === 'v9914')!;
    expect([r.unloadNote, r.status]).toEqual(['', 'empty']);
  });
});
