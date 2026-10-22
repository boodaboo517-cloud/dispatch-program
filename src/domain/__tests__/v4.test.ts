import { beforeEach, describe, expect, it } from 'vitest';
import { buildBoard, lastStart, setDriverSeq, setRowDriver, setRowHelper, setRowStart, startText } from '../board.ts';
import { blankOrder, saveOrder } from '../orders.ts';
import { Tx } from '../tx.ts';
import { ON_CALL_SHIFT, type Driver } from '../types.ts';
import { assignedDriverIds, fixedOffDays, weeklyOffOn, workDaysFromOff } from '../workforce.ts';
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
