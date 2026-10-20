import { beforeEach, describe, expect, it } from 'vitest';
import {
  acceptLinkPending, acceptShipPending, assignVehicle, blankOrder, deleteOrder, findVehicleDay,
  ignoreLinkPending, saveOrder, setRowShip,
} from '../orders.ts';
import { Tx } from '../tx.ts';
import type { Snapshot } from '../types.ts';
import { baseSnapshot, resetIds } from './fixtures.ts';

beforeEach(resetIds);

/** 10/18 육지 상차 9915 신제주운송 2p, 하행 제이엘 */
function landLoad(snap: Snapshot = baseSnapshot()) {
  const tx = new Tx(snap);
  const load = saveOrder(tx, blankOrder({
    date: '2026-10-18', zone: 'land', kind: 'load', vehicle_id: 'v9915', client_id: 'c-sin', product_id: 'p-sin',
    quantity: 2, unit: '파렛트', memo: '제주천 13p', departure_ship: '제이엘', driver_id: 'd-kim',
  }));
  return { tx, load };
}

const linkedOf = (tx: Tx, id: string) => tx.list('daily_orders').find((o) => o.linked_from_id === id)!;

describe('상차 → 다음 날 반대 지역 하차', () => {
  it('육지 상차 저장 → 다음 날 제주 하차(오전)로 복사, 기사는 비움', () => {
    const { tx, load } = landLoad();
    const u = linkedOf(tx, load.id);
    expect(u).toMatchObject({
      date: '2026-10-19', zone: 'jeju', kind: 'unload', vehicle_id: 'v9915', client_id: 'c-sin',
      product_id: 'p-sin', quantity: 2, unit: '파렛트', memo: '제주천 13p', arrival_ship: '제이엘',
      driver_id: null, source: 'linked', link_status: 'synced',
    });
  });

  it('제주 상차(오후) → 다음 날 육지 하차', () => {
    const tx = new Tx(baseSnapshot());
    const load = saveOrder(tx, blankOrder({
      date: '2026-10-18', zone: 'jeju', kind: 'load', vehicle_id: 'v8948', client_id: 'c-jr', product_id: 'p-sanji',
      memo: '야간', departure_ship: '제이엘', departure_ship_tag: '야간',
    }));
    const u = linkedOf(tx, load.id);
    expect(u.zone).toBe('land');
    expect(u.date).toBe('2026-10-19');
    expect(u.arrival_ship_tag).toBe('야간');
  });

  it('선박 "도착일 차이" 설정을 따른다 (목포 = 2일)', () => {
    const tx = new Tx(baseSnapshot());
    const load = saveOrder(tx, blankOrder({ date: '2026-10-18', zone: 'land', kind: 'load', departure_ship: '목포' }));
    expect(linkedOf(tx, load.id).date).toBe('2026-10-20');
  });

  it('수정 전파: 원본 상차를 고치면 연결 하차도 바뀐다', () => {
    const { tx, load } = landLoad();
    saveOrder(tx, { ...load, quantity: 4, memo: '제주천 15p' });
    const u = linkedOf(tx, load.id);
    expect(u.quantity).toBe(4);
    expect(u.memo).toBe('제주천 15p');
  });

  it('수동 수정 보존: 하차를 사람이 고쳤으면 덮어쓰지 않고 반영/무시를 묻는다', () => {
    const { tx, load } = landLoad();
    const u = linkedOf(tx, load.id);
    saveOrder(tx, { ...u, memo: '2번 도크' });
    saveOrder(tx, { ...load, quantity: 5 });
    const after = tx.get('daily_orders', u.id)!;
    expect(after.memo).toBe('2번 도크');
    expect(after.quantity).toBe(2);
    expect(after.link_status).toBe('source_changed');
    expect(after.link_pending).toEqual({ quantity: 5, memo: '제주천 13p' });

    ignoreLinkPending(tx, u.id);
    expect(tx.get('daily_orders', u.id)!.link_pending).toBeNull();

    saveOrder(tx, { ...tx.get('daily_orders', load.id)!, quantity: 6 });
    acceptLinkPending(tx, u.id);
    expect(tx.get('daily_orders', u.id)!.quantity).toBe(6);
  });

  it('날짜 변경: 상차 날짜를 옮기면 하차도 따라간다', () => {
    const { tx, load } = landLoad();
    saveOrder(tx, { ...load, date: '2026-10-20' });
    expect(linkedOf(tx, load.id).date).toBe('2026-10-21');
  });

  it('하차 날짜를 직접 바꾸면 그 뒤 원본 변경은 묻기로 처리', () => {
    const { tx, load } = landLoad();
    const u = linkedOf(tx, load.id);
    saveOrder(tx, { ...u, date: '2026-10-20' });
    saveOrder(tx, { ...tx.get('daily_orders', load.id)!, memo: '변경' });
    expect(tx.get('daily_orders', u.id)!.date).toBe('2026-10-20');
    expect(tx.get('daily_orders', u.id)!.link_status).toBe('source_changed');
  });

  it('삭제: 함께 삭제 / 하차는 남기기', () => {
    const a = landLoad();
    const u1 = linkedOf(a.tx, a.load.id);
    deleteOrder(a.tx, a.load.id, 'delete');
    expect(a.tx.get('daily_orders', u1.id)).toBeUndefined();

    const b = landLoad();
    const u2 = linkedOf(b.tx, b.load.id);
    deleteOrder(b.tx, b.load.id, 'keep');
    expect(b.tx.get('daily_orders', u2.id)).toMatchObject({ linked_from_id: null, link_status: 'source_deleted' });
  });

  it('배차 대기 상차에 차량을 배정하면 하차 쪽 차량번호도 채운다', () => {
    const tx = new Tx(baseSnapshot());
    const load = saveOrder(tx, blankOrder({ date: '2026-10-18', zone: 'land', kind: 'load', client_id: 'c-dm', departure_ship: '제이엘' }));
    expect(linkedOf(tx, load.id).vehicle_id).toBeNull();
    assignVehicle(tx, load.id, 'v9915');
    expect(linkedOf(tx, load.id).vehicle_id).toBe('v9915');
    // 차량 줄 출발 선박 → 다음 날 도착 선박
    expect(findVehicleDay(tx, '2026-10-19', 'v9915')?.arrival_ship).toBe('제이엘');
  });
});

describe('선박 자동 이어짐', () => {
  it('짐이 없어도 출발 선박만 넣으면 다음 날 반대 지역 줄을 만들고 선박을 채운다', () => {
    const tx = new Tx(baseSnapshot());
    setRowShip(tx, { date: '2026-10-18', vehicle_id: 'v9914', zone: 'jeju', which: 'departure', ship: '제이엘', tag: '' });
    const next = findVehicleDay(tx, '2026-10-19', 'v9914')!;
    expect(next).toMatchObject({ zone: 'land', arrival_ship: '제이엘' });
  });

  it('"아침/예약/야간" 표시도 같이 넘긴다', () => {
    const tx = new Tx(baseSnapshot());
    setRowShip(tx, { date: '2026-10-18', vehicle_id: 'v9914', zone: 'jeju', which: 'departure', ship: '마린', tag: '아침' });
    expect(findVehicleDay(tx, '2026-10-19', 'v9914')!.arrival_ship_tag).toBe('아침');
  });

  it('선박을 바꾸면 다음 날도 바뀌고, 다음 날을 직접 고쳤으면 반영/무시를 묻는다', () => {
    const tx = new Tx(baseSnapshot());
    const p = { date: '2026-10-18', vehicle_id: 'v9914', zone: 'jeju' as const, which: 'departure' as const, tag: '' as const };
    setRowShip(tx, { ...p, ship: '제이엘' });
    setRowShip(tx, { ...p, ship: '완도' });
    expect(findVehicleDay(tx, '2026-10-19', 'v9914')!.arrival_ship).toBe('완도');

    setRowShip(tx, { date: '2026-10-19', vehicle_id: 'v9914', zone: 'land', which: 'arrival', ship: '성우', tag: '' });
    setRowShip(tx, { ...p, ship: '마린' });
    const next = findVehicleDay(tx, '2026-10-19', 'v9914')!;
    expect(next.arrival_ship).toBe('성우');
    expect(next.arrival_pending).toEqual({ ship: '마린', tag: '' });
    acceptShipPending(tx, next.id);
    expect(findVehicleDay(tx, '2026-10-19', 'v9914')!.arrival_ship).toBe('마린');
  });

  it('선박을 지우면 다음 날 선박 칸을 비우고, 다른 내용이 없으면 줄도 없앤다', () => {
    const tx = new Tx(baseSnapshot());
    const p = { date: '2026-10-18', vehicle_id: 'v9914', zone: 'jeju' as const, which: 'departure' as const, tag: '' as const };
    setRowShip(tx, { ...p, ship: '제이엘' });
    setRowShip(tx, { ...p, ship: null });
    expect(findVehicleDay(tx, '2026-10-19', 'v9914')).toBeUndefined();
  });

  it('선박을 지워도 다음 날 줄에 다른 내용이 있으면 줄은 남긴다', () => {
    const tx = new Tx(baseSnapshot());
    const p = { date: '2026-10-18', vehicle_id: 'v9914', zone: 'jeju' as const, which: 'departure' as const, tag: '' as const };
    setRowShip(tx, { ...p, ship: '제이엘' });
    saveOrder(tx, blankOrder({ date: '2026-10-19', zone: 'land', kind: 'load', vehicle_id: 'v9914', client_id: 'c-dm' }));
    setRowShip(tx, { ...p, ship: null });
    const next = findVehicleDay(tx, '2026-10-19', 'v9914')!;
    expect(next).toBeDefined();
    expect(next.arrival_ship).toBeNull();
  });

  it('차량 줄 하행 선박을 바꾸면 그 차량 상차 → 연결 하차의 선박도 바뀐다', () => {
    const { tx, load } = landLoad();
    setRowShip(tx, { date: '2026-10-18', vehicle_id: 'v9915', zone: 'land', which: 'departure', ship: '완도', tag: '예약' });
    const u = linkedOf(tx, load.id);
    expect(u.arrival_ship).toBe('완도');
    expect(u.arrival_ship_tag).toBe('예약');
    expect(findVehicleDay(tx, '2026-10-19', 'v9915')!.arrival_ship).toBe('완도');
  });
});
