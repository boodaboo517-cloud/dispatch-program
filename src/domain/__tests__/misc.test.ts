import { beforeEach, describe, expect, it } from 'vitest';
import { buildBoard, setVehicleDayStatus, vehicleChoices } from '../board.ts';
import { planCreateFieldRecurring, planFieldRecurringChange, saveFieldAssignment, setDayOff } from '../fieldwork.ts';
import { checkOdometer, consumableStatus, maintenanceAlerts, saveMaintenance } from '../maintenance.ts';
import { blankOrder, saveOrder, setRowShip } from '../orders.ts';
import { computeRevenue } from '../revenue.ts';
import { abbrev, matchSearch } from '../text.ts';
import { Tx } from '../tx.ts';
import type { MaintenanceRecord } from '../types.ts';
import { baseSnapshot, resetIds, vehicle } from './fixtures.ts';

beforeEach(resetIds);

describe('글자 축약 · 초성 검색', () => {
  it('앞 4글자 + …', () => {
    expect(abbrev('신제주운송')).toBe('신제주운…');
    expect(abbrev('감귤')).toBe('감귤');
  });
  it('ㄷㄷ → 대동', () => {
    expect(matchSearch('대동물류', 'ㄷㄷ')).toBe(true);
    expect(matchSearch('도민물류', 'ㄷㅁ')).toBe(true);
    expect(matchSearch('도민물류', 'ㄷㄷ')).toBe(false);
    expect(matchSearch('제주로지', '로지')).toBe(true);
    expect(matchSearch('제주로지', '제ㅈ')).toBe(true);
  });
});

describe('매출 계산', () => {
  it('도민물류 감귤 10파렛 × 90,000 = 공급가 900,000', () => {
    expect(computeRevenue({ calc_method: 'per_pallet', unit_price: 90000, quantity: 10, extras: [] }))
      .toEqual({ supply_amount: 900000, vat: 90000, total: 990000 });
  });
  it('추가요금 · 금액 직접', () => {
    expect(computeRevenue({ calc_method: 'per_unit', unit_price: 300000, quantity: 1, extras: [{ label: '야간', amount: 50000 }] }).supply_amount).toBe(350000);
    expect(computeRevenue({ calc_method: 'fixed', unit_price: 120000, quantity: 7, extras: [] }).total).toBe(132000);
  });
});

describe('일정표 · 차량 위치', () => {
  it('등록 차량은 전부 한 줄씩, 일정 없는 차량은 공차', () => {
    const b = buildBoard(baseSnapshot(), '2026-10-20');
    expect(b.rows).toHaveLength(3);
    expect(b.summary.land).toBe(1);
    expect(b.summary.jeju).toBe(2);
    expect(b.rows.every((r) => r.status === 'empty')).toBe(true);
  });

  it('전날 하행 선박이 있으면 다음 날부터 제주에 있다', () => {
    const tx = new Tx(baseSnapshot());
    saveOrder(tx, blankOrder({ date: '2026-10-18', zone: 'land', kind: 'load', vehicle_id: 'v9915', departure_ship: '제이엘' }));
    const s = tx.result();
    const zoneOn = (d: string) => buildBoard(s, d).rows.find((r) => r.vehicle.id === 'v9915')!.zone;
    expect(zoneOn('2026-10-18')).toBe('land');
    expect(zoneOn('2026-10-19')).toBe('jeju');
    expect(zoneOn('2026-10-25')).toBe('jeju');
  });

  it('선박만 입력해도 위치가 바뀐다', () => {
    const tx = new Tx(baseSnapshot());
    setRowShip(tx, { date: '2026-10-18', vehicle_id: 'v9914', zone: 'jeju', which: 'departure', ship: '제이엘', tag: '' });
    expect(buildBoard(tx.result(), '2026-10-20').rows.find((r) => r.vehicle.id === 'v9914')!.zone).toBe('land');
  });

  it('위치 미정 차량은 경고 목록', () => {
    const s = baseSnapshot();
    s.vehicles.push(vehicle('vx', '0001', { home_zone: null }));
    expect(buildBoard(s, '2026-10-20').unknownLocation.map((v) => v.id)).toEqual(['vx']);
  });

  it('배차 대기: 차량 없는 상차는 출항시간 순', () => {
    const tx = new Tx(baseSnapshot());
    saveOrder(tx, blankOrder({ date: '2026-10-20', zone: 'land', kind: 'load', departure_ship: '제이엘', client_text: 'B' }));
    saveOrder(tx, blankOrder({ date: '2026-10-20', zone: 'land', kind: 'load', departure_ship: '완도', client_text: 'A' }));
    const b = buildBoard(tx.result(), '2026-10-20');
    expect(b.waiting.land.map((o) => o.client_text)).toEqual(['A', 'B']);
    expect(b.summary.waiting).toBe(2);
  });

  it('정비 기간 동안 수리로 자동 표시, 배차 선택에서 경고', () => {
    const tx = new Tx(baseSnapshot());
    setVehicleDayStatus(tx, {
      date: '2026-10-20', vehicle_id: 'v9915', zone: 'land', status: 'repair', memo: '',
      maintenance: { kind: '적재함 수리', shop: '회성', end_date: '2026-10-22' },
    });
    const s = tx.result();
    expect(s.maintenance_records).toHaveLength(1);
    const b = buildBoard(s, '2026-10-21');
    const row = b.rows.find((r) => r.vehicle.id === 'v9915')!;
    expect(row.status).toBe('repair');
    expect(row.statusMemo).toContain('적재함 수리 · 회성');
    expect(vehicleChoices(b, 'land').find((c) => c.row.vehicle.id === 'v9915')!.warn).toBe('수리 중');
    expect(buildBoard(s, '2026-10-23').rows.find((r) => r.vehicle.id === 'v9915')!.status).toBe('empty');
  });
});

describe('정비 · 주행거리', () => {
  const rec = (p: Partial<MaintenanceRecord>): MaintenanceRecord => ({
    id: 'm1', vehicle_id: 'v9915', kind: '엔진오일', shop: '정비실', start_date: '2026-09-01', end_date: '2026-09-01',
    odometer_km: 100000, cost: null, staff_id: null, memo: '', photo_paths: [], ...p,
  });

  it('주행거리: 이전보다 작거나 하루 2,000km 이상이면 확인 요청', () => {
    const logs = [{ id: 'o1', vehicle_id: 'v9915', date: '2026-10-10', km: 100000 }];
    expect(checkOdometer(logs, 'v9915', '2026-10-11', 99000)).toHaveLength(1);
    expect(checkOdometer(logs, 'v9915', '2026-10-11', 102500)).toHaveLength(1);
    expect(checkOdometer(logs, 'v9915', '2026-10-11', 100500)).toHaveLength(0);
  });

  it('엔진오일 진행률과 예상 교환일', () => {
    const s = baseSnapshot();
    s.maintenance_records = [rec({})];
    s.odometer_logs = [
      { id: 'a', vehicle_id: 'v9915', date: '2026-10-01', km: 108000 },
      { id: 'b', vehicle_id: 'v9915', date: '2026-10-11', km: 111000 },
    ];
    const st = consumableStatus(s, 'v9915', '엔진오일', 15000, '2026-10-11');
    expect(st.usedKm).toBe(11000);
    expect(st.remainingKm).toBe(4000);
    expect(st.level).toBe('warn');
    expect(st.expectedDate).toBe('2026-10-25'); // 하루 300km
  });

  it('남은 거리 1,000km 이하이면 알림', () => {
    const s = baseSnapshot();
    s.maintenance_records = [rec({})];
    s.odometer_logs = [{ id: 'b', vehicle_id: 'v9915', date: '2026-10-19', km: 114500 }];
    expect(maintenanceAlerts(s, '2026-10-20').some((a) => a.message.includes('엔진오일 500km 남음'))).toBe(true);
  });

  it('정비실 직원이 입고 처리하면 현장근무 업무란에 표시', () => {
    const s = baseSnapshot();
    s.field_sites = [{ id: 'site-m', name: '정비실', sort_order: 0 }];
    s.vehicles.push(vehicle('v8953', '8953'));
    const tx = new Tx(s);
    saveMaintenance(tx, rec({ id: 'm2', vehicle_id: 'v8953', kind: '적재함 수리', start_date: '2026-10-20', end_date: null, staff_id: 'staff1' }));
    const f = tx.list('field_assignments')[0];
    expect(f).toMatchObject({ date: '2026-10-20', task: '8953 적재함 수리 입고', site_id: 'site-m', staff_id: 'staff1' });
  });
});

describe('현장근무 고정 근무', () => {
  const fields = { weekdays: [1, 2, 3, 4, 5, 6] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[], site_id: 's-hd', task: '배차관리', vehicle_id: 'v7693' };

  it('변경 시 과거 불변 + 그날만 수정한 칸 보존', () => {
    const r = planCreateFieldRecurring(baseSnapshot(), { staff_id: 'kang', fields, startDate: '2026-10-05', today: '2026-10-05' });
    const target = r.snapshot.field_assignments.find((f) => f.date === '2026-10-28')!;
    const tx = new Tx(r.snapshot);
    saveFieldAssignment(tx, { ...target, task: '부두 픽업' });
    const before = tx.result().field_assignments.filter((f) => f.date < '2026-10-26');
    const c = planFieldRecurringChange(tx.result(), { recurringId: target.recurring_field_id!, fields: { ...fields, task: '배송지원' }, startDate: '2026-10-26', today: '2026-10-20' });
    expect(c.snapshot.field_assignments.filter((f) => f.date < '2026-10-26')).toEqual(before);
    expect(c.snapshot.field_assignments.find((f) => f.id === target.id)!.task).toBe('부두 픽업');
    expect(c.snapshot.field_assignments.find((f) => f.date === '2026-10-27')!.task).toBe('배송지원');
    expect(c.keptManual).toBe(1);
  });

  it('휴무 지정 시 그날 고정 근무 줄 대신 휴무자 줄', () => {
    const r = planCreateFieldRecurring(baseSnapshot(), { staff_id: 'kang', fields, startDate: '2026-10-20', today: '2026-10-20' });
    const tx = new Tx(r.snapshot);
    setDayOff(tx, '2026-10-21', 'kang', true);
    const day = tx.list('field_assignments').filter((f) => f.date === '2026-10-21');
    expect(day).toHaveLength(1);
    expect(day[0].is_off).toBe(true);
  });
});
