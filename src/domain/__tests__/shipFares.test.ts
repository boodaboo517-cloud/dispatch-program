import { beforeEach, describe, expect, it } from 'vitest';
import { blankOrder, setRowShip } from '../orders.ts';
import { createOrder } from '../actions.ts';
import { bulkCosts, setBulkFee, setShipFare, setVoyage, shipCosts } from '../shipFares.ts';
import { Tx } from '../tx.ts';
import { baseSnapshot, resetIds } from './fixtures.ts';

beforeEach(resetIds);
const D = '2026-10-20';

describe('선박 운임', () => {
  it('짐 있으면 기본, 공차면 공차, 할증은 직접 · 승선 금액 추가 · 차종 요금이 우선', () => {
    const s = baseSnapshot();
    const tx = new Tx(s);
    const jl = s.ships.find((x) => x.name === '제이엘')!;
    setShipFare(tx, { ship_id: jl.id, vehicle_type: '', base: 300000, empty: 200000, surcharge: 360000, boarding: 50000 });
    createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: 'c-dm', vehicle_id: 'v9915', departure_ship: '제이엘' }));
    setRowShip(tx, { date: D, vehicle_id: 'v9914', zone: 'land', which: 'departure', ship: '제이엘', tag: '' });
    let vs = shipCosts(tx.result(), D, D);
    const of = (v: string) => vs.find((x) => x.row.vehicle.id === v)!;
    expect([of('v9915').kind, of('v9915').fare]).toEqual(['base', 300000]);
    expect([of('v9914').kind, of('v9914').fare]).toEqual(['empty', 200000]);
    setVoyage(tx, { date: D, vehicle_id: 'v9915', zone: 'land', fare_kind: 'surcharge', boarding: true });
    vs = shipCosts(tx.result(), D, D);
    expect([of('v9915').kind, of('v9915').fare, of('v9915').boarding, of('v9915').total]).toEqual(['surcharge', 360000, 50000, 410000]);
    // 차종 요금
    const type = tx.result().vehicles.find((v) => v.id === 'v9914')!.vehicle_type;
    setShipFare(tx, { ship_id: jl.id, vehicle_type: type, base: 250000, empty: 150000, surcharge: null, boarding: null });
    vs = shipCosts(tx.result(), D, D);
    expect(of('v9914').fare).toBe(150000);
  });
  it('요금이 없으면 미입력으로 알림, 대기는 배 안 탐', () => {
    const tx = new Tx(baseSnapshot());
    createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: 'c-dm', vehicle_id: 'v9915', departure_ship: '완도' }));
    createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: 'c-dm', vehicle_id: 'v9914', departure_ship: '대기' }));
    const vs = shipCosts(tx.result(), D, D);
    expect(vs.map((v) => v.row.vehicle.id)).toEqual(['v9915']);
    expect(vs[0].missing).toEqual(['완도 요금']);
  });
});

describe('벌크 요금 (품목마다)', () => {
  it('파렛트당은 수량 × 요금, 금액 직접은 건당, 요금 없으면 미등록 · 대기는 제외', () => {
    const tx = new Tx(baseSnapshot());
    const [p1, p2] = tx.list('products');
    setBulkFee(tx, p1.id, 'per_pallet', 15000);
    setBulkFee(tx, p2.id, 'fixed', 120000);
    createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: p1.client_id, product_id: p1.id, quantity: 10, unit: '파렛트', shipment: 'bulk', departure_ship: '제이엘' }));
    createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: p2.client_id, product_id: p2.id, quantity: 3, shipment: 'bulk', departure_ship: '완도' }));
    createOrder(tx, blankOrder({ date: D, zone: 'land', kind: 'load', client_id: p1.client_id, product_id: p1.id, quantity: 5, shipment: 'bulk', departure_ship: '대기' }));
    const bs = bulkCosts(tx.result(), D, D);
    expect(bs.map((b) => [b.ship, b.fee])).toEqual([['제이엘', 150000], ['완도', 120000]]);
    setBulkFee(tx, p2.id, 'fixed', null);
    expect(bulkCosts(tx.result(), D, D)[1].missing).toBe('품목 벌크 요금 미등록');
  });
});
