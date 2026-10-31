import { beforeEach, describe, expect, it } from 'vitest';
import { blankOrder, findVehicleDay, saveOrder, unassignOrder } from '../orders.ts';
import { buildBoard, carryDriverless, setRowDriver } from '../board.ts';
import { Tx } from '../tx.ts';
import { baseSnapshot, resetIds } from './fixtures.ts';

beforeEach(resetIds);

describe('배차 취소 → 미배차', () => {
  it('상차 차량 취소: 차량·기사 비움, 연결 하차도 미배차, 차량 출발 선박·다음 날 도착 정리', () => {
    const tx = new Tx(baseSnapshot());
    const load = saveOrder(tx, blankOrder({
      date: '2026-10-18', zone: 'land', kind: 'load', vehicle_id: 'v9915', client_id: 'c-sin', product_id: 'p-sin',
      departure_ship: '제이엘', driver_id: 'd-kim',
    }));
    expect(findVehicleDay(tx, '2026-10-18', 'v9915')?.departure_ship).toBe('제이엘');
    unassignOrder(tx, load.id);
    expect(tx.get('daily_orders', load.id)).toMatchObject({ vehicle_id: null, driver_id: null, departure_ship: '제이엘' });
    const u = tx.list('daily_orders').find((o) => o.linked_from_id === load.id)!;
    expect(u.vehicle_id).toBeNull();
    expect(findVehicleDay(tx, '2026-10-18', 'v9915')?.departure_ship ?? null).toBeNull();
    expect(findVehicleDay(tx, '2026-10-19', 'v9915')?.arrival_ship ?? null).toBeNull();
    const b = buildBoard(tx.result(), '2026-10-18');
    expect(b.waiting.land.map((o) => o.id)).toContain(load.id);
  });

  it('용차 취소도 미배차로', () => {
    const tx = new Tx(baseSnapshot());
    const o = saveOrder(tx, blankOrder({ date: '2026-10-18', zone: 'land', kind: 'load', client_id: 'c-sin', carrier_type: 'hired', carrier_name: '대한용차' }));
    unassignOrder(tx, o.id);
    expect(tx.get('daily_orders', o.id)).toMatchObject({ carrier_type: 'own', carrier_name: '' });
    expect(buildBoard(tx.result(), '2026-10-18').waiting.land.map((x) => x.id)).toContain(o.id);
  });
});

describe('기사 없는 차량 일정 → 오늘로 이어짐', () => {
  const today = '2026-10-20';
  it('기사 없는 차량의 짐은 같은 차량으로 오늘로 · 연결 하차도 따라감 · 미배차·기사 있는 차량은 그대로', () => {
    const tx = new Tx(baseSnapshot());
    const load = saveOrder(tx, blankOrder({ date: '2026-10-19', zone: 'land', kind: 'load', client_id: 'c-sin', vehicle_id: 'v9915', departure_ship: '제이엘' }));
    const waiting = saveOrder(tx, blankOrder({ date: '2026-10-19', zone: 'land', kind: 'load', client_id: 'c-sin' }));
    const staffed = saveOrder(tx, blankOrder({ date: '2026-10-19', zone: 'jeju', kind: 'unload', client_id: 'c-sin', vehicle_id: 'v9914' }));
    setRowDriver(tx, { date: '2026-10-19', vehicle_id: 'v9914', zone: 'jeju', driver_id: 'd-kim', side: 'unload' });
    const old = saveOrder(tx, blankOrder({ date: '2026-10-01', zone: 'jeju', kind: 'unload', client_id: 'c-sin', vehicle_id: 'v8948' }));
    const n = carryDriverless(tx, today);
    expect(n).toBe(1);
    expect(tx.get('daily_orders', load.id)).toMatchObject({ date: today, vehicle_id: 'v9915' });
    expect(tx.list('daily_orders').find((o) => o.linked_from_id === load.id)!.date).toBe('2026-10-21');
    expect(findVehicleDay(tx, today, 'v9915')).toMatchObject({ zone: 'land', departure_ship: '제이엘', arrival_ship: null });
    expect(findVehicleDay(tx, '2026-10-19', 'v9915')?.departure_ship ?? null).toBeNull();
    expect(tx.get('daily_orders', waiting.id)!.date).toBe('2026-10-19');
    expect(tx.get('daily_orders', staffed.id)!.date).toBe('2026-10-19');
    expect(tx.get('daily_orders', old.id)!.date).toBe('2026-10-01');
    expect(carryDriverless(tx, today)).toBe(0);
  });

  it('반복 발주 오더는 오늘 것과 겹치지 않게 직접 입력으로', () => {
    const tx = new Tx(baseSnapshot());
    const o = saveOrder(tx, blankOrder({ date: '2026-10-19', zone: 'jeju', kind: 'load', client_id: 'c-sin', vehicle_id: 'v9914', source: 'recurring', recurring_order_id: 'r1' }), { userEdit: false });
    carryDriverless(tx, today);
    expect(tx.get('daily_orders', o.id)).toMatchObject({ date: today, vehicle_id: 'v9914', source: 'manual', edited_manually: true, recurring_order_id: 'r1' });
  });
});
