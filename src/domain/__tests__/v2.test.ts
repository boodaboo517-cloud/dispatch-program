import { beforeEach, describe, expect, it } from 'vitest';
import { buildBoard, isDriverWorking, moveVehicle, nudgeVehicle } from '../board.ts';
import { blankOrder, findVehicleDay, saveOrder } from '../orders.ts';
import { formatShip, parseShip, shipChoices, shipTimeOf } from '../ships.ts';
import { Tx } from '../tx.ts';
import type { Driver } from '../types.ts';
import { monthlyDriverStatus, paySummary, setDayKind, setDayPay, setPayRate, setWorkLog } from '../workforce.ts';
import { isDriverWorking } from '../board.ts';
import { baseSnapshot, resetIds, ship } from './fixtures.ts';

beforeEach(resetIds);

const driver = (p: Partial<Driver>): Driver => ({ id: 'd1', name: '김기사', phone: '', work_days: [1, 3], shift: '월수', affiliation: '', staff_type: '기사', ...p });

describe('당일 왕복 (제주 차량이 올라가 상차하고 같은 날 내려옴)', () => {
  function trip() {
    const tx = new Tx(baseSnapshot());
    // 9914 는 제주에 있음. 아침에 하차(제주 오전) 후 올라가서 육지 상차 → 같은 날 제주로 복귀
    saveOrder(tx, blankOrder({ date: '2026-10-20', zone: 'jeju', kind: 'unload', vehicle_id: 'v9914', client_text: '아침 하차' }));
    const load = saveOrder(tx, blankOrder({
      date: '2026-10-20', zone: 'land', kind: 'load', vehicle_id: 'v9914', client_id: 'c-dm', departure_ship: '완도', same_day: true,
    }));
    return { tx, load };
  }

  it('연결 하차가 같은 날짜 제주에 생긴다', () => {
    const { tx, load } = trip();
    const u = tx.list('daily_orders').find((o) => o.linked_from_id === load.id)!;
    expect(u.date).toBe('2026-10-20');
    expect(u.zone).toBe('jeju');
  });

  it('차량 위치는 제주 그대로, 다음 날도 제주', () => {
    const { tx } = trip();
    expect(findVehicleDay(tx, '2026-10-20', 'v9914')!.zone).toBe('jeju');
    const s = tx.result();
    const zoneOn = (d: string) => buildBoard(s, d).rows.find((r) => r.vehicle.id === 'v9914' && !r.secondary)!.zone;
    expect(zoneOn('2026-10-20')).toBe('jeju');
    expect(zoneOn('2026-10-21')).toBe('jeju');
    // 다음 날 반대편에 선박 이어짐 줄이 생기지 않는다
    expect(findVehicleDay(tx, '2026-10-21', 'v9914')).toBeUndefined();
  });

  it('그날 일정표: 제주 본 줄 + 육지 보조 줄, 대수는 1대로 센다', () => {
    const b = buildBoard(trip().tx.result(), '2026-10-20');
    const rows = b.rows.filter((r) => r.vehicle.id === 'v9914');
    expect(rows.map((r) => [r.zone, r.secondary])).toEqual([['jeju', false], ['land', true]]);
    expect(rows[1].loads).toHaveLength(1);
    expect(rows[0].unloads).toHaveLength(2); // 아침 하차 + 같은 날 복귀 하차
    expect(b.summary.jeju).toBe(2); // 9914, 8948
    expect(b.summary.land).toBe(1); // 9915
  });

  it('그날 다른 기록이 없어도 당일 왕복 상차만 넣으면 차량은 출발한 쪽(제주)에 남는다', () => {
    const tx = new Tx(baseSnapshot());
    const load = saveOrder(tx, blankOrder({ date: '2026-10-20', zone: 'land', kind: 'load', vehicle_id: 'v9914', departure_ship: '완도', same_day: true }));
    expect(findVehicleDay(tx, '2026-10-20', 'v9914')!.zone).toBe('jeju');
    const b = buildBoard(tx.result(), '2026-10-20');
    const rows = b.rows.filter((r) => r.vehicle.id === 'v9914');
    expect(rows.map((r) => [r.zone, r.secondary])).toEqual([['jeju', false], ['land', true]]);
    expect(rows[1].loads.map((o) => o.id)).toEqual([load.id]);
    expect(buildBoard(tx.result(), '2026-10-21').rows.find((r) => r.vehicle.id === 'v9914')!.zone).toBe('jeju');
  });

  it('당일 왕복이 아닌 상차만 있으면 차량은 그 구역으로 옮겨진다', () => {
    const tx = new Tx(baseSnapshot());
    saveOrder(tx, blankOrder({ date: '2026-10-20', zone: 'land', kind: 'load', vehicle_id: 'v9914', departure_ship: '제이엘' }));
    expect(findVehicleDay(tx, '2026-10-20', 'v9914')!.zone).toBe('land');
  });
});

describe('선박 기항지별 하행 시간', () => {
  const ships = [
    ship('퀸메리', '16:30', { port_times: [{ port: '목포', time: '01:00' }, { port: '완도', time: '08:30' }] }),
    ship('제이엘', '16:10'),
  ];
  it('"선박 (기항지)" 값 해석', () => {
    expect(parseShip('퀸메리 (목포)')).toEqual({ name: '퀸메리', port: '목포' });
    expect(parseShip('제이엘')).toEqual({ name: '제이엘', port: '' });
    expect(formatShip('퀸메리', '완도')).toBe('퀸메리 (완도)');
  });
  it('기항지가 있으면 그 하행 시간, 없으면 제주 출발 시간', () => {
    expect(shipTimeOf(ships, '퀸메리 (완도)')).toBe('08:30');
    expect(shipTimeOf(ships, '퀸메리')).toBe('16:30');
  });
  it('육지 하행선박 목록은 기항지별, 제주 오후 선박 목록은 제주 출발 시간', () => {
    expect(shipChoices(ships, 'land', 'departure').map((c) => c.value)).toEqual(['퀸메리 (목포)', '퀸메리 (완도)', '제이엘']);
    expect(shipChoices(ships, 'jeju', 'departure').map((c) => `${c.value} ${c.time}`)).toEqual(['제이엘 16:10', '퀸메리 16:30']);
  });
  it('기항지가 붙어도 도착일 차이는 선박 설정을 따른다', () => {
    const s = baseSnapshot();
    s.ships.push(ship('퀸메리', '16:30', { arrival_day_offset: 2, port_times: [{ port: '목포', time: '01:00' }] }));
    const tx = new Tx(s);
    const load = saveOrder(tx, blankOrder({ date: '2026-10-20', zone: 'land', kind: 'load', departure_ship: '퀸메리 (목포)' }));
    expect(tx.list('daily_orders').find((o) => o.linked_from_id === load.id)!.date).toBe('2026-10-22');
  });
});

describe('기사 근무', () => {
  it('알바는 출근 기록이 있는 날만 근무', () => {
    const s = baseSnapshot();
    const d = driver({ shift: '알바', work_days: [] });
    s.drivers = [d];
    expect(isDriverWorking(s, d, '2026-10-19')).toBe(false);
    const tx = new Tx(s);
    setWorkLog(tx, { date: '2026-10-19', driver_id: 'd1', work_types: ['단거리'] });
    expect(isDriverWorking(tx.result(), d, '2026-10-19')).toBe(true);
  });

  it('근무형태를 모두 지우면 기록이 없어진다', () => {
    const s = baseSnapshot();
    s.drivers = [driver({})];
    const tx = new Tx(s);
    setWorkLog(tx, { date: '2026-10-19', driver_id: 'd1', work_types: ['야간근무', '장거리', '야간근무'] });
    expect(tx.list('driver_work_logs')[0].work_types).toEqual(['야간근무', '장거리']);
    setWorkLog(tx, { date: '2026-10-19', driver_id: 'd1', work_types: [] });
    expect(tx.list('driver_work_logs')).toHaveLength(0);
  });

  it('월간 근무현황: 근무일수 · 형태별 횟수 · 형태 미입력 배차', () => {
    const s = baseSnapshot();
    s.drivers = [driver({})];
    const tx = new Tx(s);
    setWorkLog(tx, { date: '2026-10-05', driver_id: 'd1', work_types: ['주간근무'] });
    setWorkLog(tx, { date: '2026-10-07', driver_id: 'd1', work_types: ['야간근무', '장거리'] });
    saveOrder(tx, blankOrder({ date: '2026-10-12', zone: 'land', kind: 'load', vehicle_id: 'v9915', driver_id: 'd1' }));
    const [m] = monthlyDriverStatus(tx.result(), '2026-10-01', '2026-10-31');
    expect(m.workedDays).toBe(3);
    expect(m.byType.야간근무).toBe(1);
    expect(m.byType.주간근무).toBe(1);
    expect(m.missingType).toBe(1);
    expect(m.days.find((c) => c.date === '2026-10-12')!.assigned).toBe(true);
  });
  it('근무별 수당: 횟수 × 수당, 수당 없는 형태는 따로 알림', () => {
    const s = baseSnapshot();
    s.drivers = [driver({})];
    const tx = new Tx(s);
    setWorkLog(tx, { date: '2026-10-05', driver_id: 'd1', work_types: ['주간근무'] });
    setWorkLog(tx, { date: '2026-10-06', driver_id: 'd1', work_types: ['주간근무', '시간외근무'], overtime_hours: 1 });
    setWorkLog(tx, { date: '2026-10-07', driver_id: 'd1', work_types: ['야간근무'] });
    setPayRate(tx, { driver_id: 'd1', type: '주간근무', amount: 120000 });
    setPayRate(tx, { driver_id: 'd1', type: '시간외근무', amount: 20000 });
    const [m] = monthlyDriverStatus(tx.result(), '2026-10-01', '2026-10-31');
    const p = paySummary(tx.result(), m);
    expect(p.byType).toEqual({ 주간근무: 240000, 시간외근무: 20000 });
    expect(p.total).toBe(260000);
    expect(p.missingRate).toEqual(['야간근무']);
    setPayRate(tx, { driver_id: 'd1', type: '시간외근무', amount: null });
    expect(tx.list('driver_pay_rates')).toHaveLength(1);
    expect(tx.list('driver_pay_rates')[0].rates).toEqual({ 주간근무: 120000 });
  });
  it('시간외근무: 시간 × 시간당, 그날 금액을 적으면 그 금액', () => {
    const s = baseSnapshot();
    s.drivers = [driver({})];
    const tx = new Tx(s);
    setPayRate(tx, { driver_id: 'd1', type: '시간외근무', amount: 15000 });
    setWorkLog(tx, { date: '2026-10-05', driver_id: 'd1', work_types: ['시간외근무'], overtime_hours: 2 });
    setWorkLog(tx, { date: '2026-10-06', driver_id: 'd1', work_types: ['시간외근무'], overtime_hours: 3 });
    setDayPay(tx, { date: '2026-10-06', driver_id: 'd1', amount: 50000 });
    let [m] = monthlyDriverStatus(tx.result(), '2026-10-01', '2026-10-31');
    expect(m.overtimeHours).toBe(5);
    expect(paySummary(tx.result(), m).byType.시간외근무).toBe(30000 + 50000);
    // 시간외를 빼면 그날 금액도 지워진다
    setWorkLog(tx, { date: '2026-10-06', driver_id: 'd1', work_types: ['주간근무'] });
    expect(tx.list('driver_day_pay')).toHaveLength(0);
    [m] = monthlyDriverStatus(tx.result(), '2026-10-01', '2026-10-31');
    expect(m.overtimeHours).toBe(2);
  });
  it('휴무 · 근무일 아님 지정', () => {
    const s = baseSnapshot();
    const d = driver({});
    s.drivers = [d];
    const tx = new Tx(s);
    saveOrder(tx, blankOrder({ date: '2026-10-12', zone: 'land', kind: 'load', vehicle_id: 'v9915', driver_id: 'd1' }));
    setDayKind(tx, { date: '2026-10-12', driver_id: 'd1', kind: 'off' });
    let [m] = monthlyDriverStatus(tx.result(), '2026-10-12', '2026-10-12');
    expect(m.days[0].off).toBe(true);
    expect(tx.list('daily_orders')[0].driver_id).toBeNull(); // 배차에서 빠짐
    setDayKind(tx, { date: '2026-10-12', driver_id: 'd1', kind: 'nonwork' });
    [m] = monthlyDriverStatus(tx.result(), '2026-10-12', '2026-10-12');
    expect([m.days[0].off, m.days[0].nonwork, m.workedDays]).toEqual([false, true, 0]);
    expect(isDriverWorking(tx.result(), d, '2026-10-12')).toBe(false);
    setDayKind(tx, { date: '2026-10-12', driver_id: 'd1', kind: 'work', work_types: ['주간근무'] });
    [m] = monthlyDriverStatus(tx.result(), '2026-10-12', '2026-10-12');
    expect([m.days[0].nonwork, m.workedDays]).toEqual([false, 1]);
  });
});

describe('일정표 차량 순서', () => {
  it('끌어다 놓기: 대상 차량 자리로 이동, 전체 순서 다시 매김', () => {
    const s = baseSnapshot();
    s.vehicles.forEach((v, i) => (v.sort_order = i)); // 9915, 9914, 8948
    const tx = new Tx(s);
    moveVehicle(tx, 'v8948', 'v9915');
    expect([...tx.list('vehicles')].sort((a, b) => a.sort_order - b.sort_order).map((v) => v.short_no)).toEqual(['8948', '9915', '9914']);
    nudgeVehicle(tx, 'v8948', 1);
    expect([...tx.list('vehicles')].sort((a, b) => a.sort_order - b.sort_order).map((v) => v.short_no)).toEqual(['9915', '8948', '9914']);
  });
});
