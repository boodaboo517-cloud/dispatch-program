import { beforeEach, describe, expect, it } from 'vitest';
import { buildBoard } from '../board.ts';
import { assignVehicle, blankOrder, findVehicleDay, saveOrder } from '../orders.ts';
import { Tx } from '../tx.ts';
import { baseSnapshot, resetIds } from './fixtures.ts';

beforeEach(resetIds);
const linked = (tx: Tx, id: string) => tx.list('daily_orders').find((o) => o.linked_from_id === id)!;

describe('벌크 (화물만 선적 → 도착지에서 다시 배차)', () => {
  function bulk() {
    const tx = new Tx(baseSnapshot());
    const load = saveOrder(tx, blankOrder({
      date: '2026-10-20', zone: 'land', kind: 'load', vehicle_id: 'v9915', client_id: 'c-dm', departure_ship: '제이엘', shipment: 'bulk', driver_id: 'd1',
    }));
    return { tx, load };
  }
  it('반대편 하차는 차량 없이 생겨 배차 대기로 나온다', () => {
    const { tx, load } = bulk();
    const u = linked(tx, load.id);
    expect(u).toMatchObject({ date: '2026-10-21', zone: 'jeju', vehicle_id: null, arrival_ship: '제이엘' });
    expect(buildBoard(tx.result(), '2026-10-21').waiting.jeju.map((o) => o.id)).toEqual([u.id]);
  });
  it('차량은 배를 타지 않는다: 다음 날도 육지, 선박 이어짐 없음', () => {
    const { tx } = bulk();
    expect(findVehicleDay(tx, '2026-10-20', 'v9915')!.departure_ship).toBeNull();
    expect(findVehicleDay(tx, '2026-10-21', 'v9915')).toBeUndefined();
    expect(buildBoard(tx.result(), '2026-10-21').rows.find((r) => r.vehicle.id === 'v9915')!.zone).toBe('land');
  });
  it('하차 쪽에서 다시 배차해도 원본 상차가 바뀌면 하차 차량은 덮어쓰지 않는다', () => {
    const { tx, load } = bulk();
    const u = linked(tx, load.id);
    assignVehicle(tx, u.id, 'v9914');
    saveOrder(tx, { ...tx.get('daily_orders', load.id)!, quantity: 7 });
    const after = tx.get('daily_orders', u.id)!;
    expect(after.vehicle_id).toBe('v9914');
    expect(after.link_pending).toMatchObject({ quantity: 7 });
  });
});

describe('마감으로 다음 배 (하차 날짜 조정)', () => {
  it('arrival_offset 이 선박 설정보다 우선', () => {
    const tx = new Tx(baseSnapshot());
    const load = saveOrder(tx, blankOrder({ date: '2026-10-20', zone: 'land', kind: 'load', departure_ship: '제이엘', shipment: 'bulk', arrival_offset: 2 }));
    expect(linked(tx, load.id).date).toBe('2026-10-22');
    saveOrder(tx, { ...tx.get('daily_orders', load.id)!, arrival_offset: null });
    expect(linked(tx, load.id).date).toBe('2026-10-21');
  });
});

describe('용차 · 화주배차', () => {
  it('차량번호 없이도 배차 대기로 세지 않고 따로 모은다, 연결 하차에 용차 정보 복사', () => {
    const tx = new Tx(baseSnapshot());
    const load = saveOrder(tx, blankOrder({
      date: '2026-10-20', zone: 'land', kind: 'load', client_id: 'c-dm', departure_ship: '제이엘',
      carrier_type: 'hired', carrier_name: '대한운송 김기사', carrier_vehicle: '부산12가3456', carrier_phone: '010-1111-2222',
    }));
    const b = buildBoard(tx.result(), '2026-10-20');
    expect(b.waiting.land).toHaveLength(0);
    expect(b.external.land.map((o) => o.id)).toEqual([load.id]);
    expect(b.summary.waiting).toBe(0);
    expect(linked(tx, load.id)).toMatchObject({ carrier_type: 'hired', carrier_vehicle: '부산12가3456', vehicle_id: null });
    expect(buildBoard(tx.result(), '2026-10-21').external.jeju).toHaveLength(1);
  });
});

describe('상차 등록 후 품목 변경', () => {
  it('품목을 바꾸면 연결 하차 품목도 바뀐다', () => {
    const tx = new Tx(baseSnapshot());
    const load = saveOrder(tx, blankOrder({ date: '2026-10-20', zone: 'land', kind: 'load', client_id: 'c-dm', product_id: 'p-gam', departure_ship: '제이엘' }));
    saveOrder(tx, { ...load, product_id: 'p-sin' });
    expect(linked(tx, load.id).product_id).toBe('p-sin');
  });
});

import { composeShipTag, splitShipTag } from '../ships.ts';
describe('다른 물류업체가 예약한 배', () => {
  it('표시 글자 만들기 · 되돌리기', () => {
    expect(composeShipTag('야간', '대한물류')).toBe('야간 · 대한물류 예약');
    expect(composeShipTag('예약', '대한물류')).toBe('대한물류 예약');
    expect(composeShipTag('아침', '')).toBe('아침');
    expect(splitShipTag('야간 · 대한물류 예약')).toEqual({ base: '야간', booker: '대한물류' });
    expect(splitShipTag('대한물류 예약')).toEqual({ base: '', booker: '대한물류' });
    expect(splitShipTag('예약')).toEqual({ base: '예약', booker: '' });
  });
  it('예약 업체 표시도 다음 날 반대편 선박 칸으로 이어진다', () => {
    const tx = new Tx(baseSnapshot());
    const load = saveOrder(tx, blankOrder({ date: '2026-10-20', zone: 'land', kind: 'load', vehicle_id: 'v9915', departure_ship: '제이엘', departure_ship_tag: '대한물류 예약' }));
    expect(linked(tx, load.id).arrival_ship_tag).toBe('대한물류 예약');
    expect(findVehicleDay(tx, '2026-10-21', 'v9915')!.arrival_ship_tag).toBe('대한물류 예약');
  });
});

describe('배차 안 된 짐은 상차 예정 지역에만', () => {
  it('차량 없는 육지 상차의 제주 하차는 제주 배차 대기에 안 나오고, 배차하면 차량 줄에 나온다', () => {
    const tx = new Tx(baseSnapshot());
    const load = saveOrder(tx, blankOrder({ date: '2026-10-20', zone: 'land', kind: 'load', client_id: 'c-dm', departure_ship: '제이엘' }));
    expect(buildBoard(tx.result(), '2026-10-20').waiting.land.map((o) => o.id)).toEqual([load.id]);
    expect(buildBoard(tx.result(), '2026-10-21').waiting.jeju).toHaveLength(0);
    assignVehicle(tx, load.id, 'v9915');
    const b = buildBoard(tx.result(), '2026-10-21');
    expect(b.waiting.jeju).toHaveLength(0);
    expect(b.rows.find((r) => r.vehicle.id === 'v9915')!.unloads).toHaveLength(1);
  });
  it('벌크 하차와 직접 입력한 미배차 하차는 그 지역에 계속 나온다', () => {
    const tx = new Tx(baseSnapshot());
    saveOrder(tx, blankOrder({ date: '2026-10-20', zone: 'land', kind: 'load', client_id: 'c-dm', departure_ship: '제이엘', shipment: 'bulk' }));
    saveOrder(tx, blankOrder({ date: '2026-10-21', zone: 'jeju', kind: 'unload', client_id: 'c-sin' }));
    expect(buildBoard(tx.result(), '2026-10-21').waiting.jeju).toHaveLength(2);
  });
});
