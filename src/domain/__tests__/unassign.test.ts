import { beforeEach, describe, expect, it } from 'vitest';
import { blankOrder, findVehicleDay, saveOrder, unassignOrder } from '../orders.ts';
import { buildBoard } from '../board.ts';
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
