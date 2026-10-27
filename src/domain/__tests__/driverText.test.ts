import { describe, expect, it } from 'vitest';
import { buildBoard } from '../board.ts';
import { blankOrder, saveOrder, setRowShip } from '../orders.ts';
import { setRowDriver, setRowNightDriver } from '../board.ts';
import { Tx } from '../tx.ts';
import { baseSnapshot } from './fixtures.ts';
import { driverDayText, peopleOn } from '../../pages/schedule/driverText.ts';

const D = '2026-10-20';

describe('기사별 일정 문자', () => {
  it('맡은 오전·오후 · 선박 · 야간이 문자에 들어가고, 다른 사람 일은 빠진다', () => {
    const s = baseSnapshot();
    s.drivers = [
      { id: 'dA', name: '김재표' } as never,
      { id: 'dB', name: '최현수' } as never,
    ];
    const tx = new Tx(s);
    saveOrder(tx, blankOrder({ date: D, zone: 'jeju', kind: 'unload', vehicle_id: 'v9915', client_id: 'c-sin', product_id: 'p-sin', quantity: 2, unit: '파렛트', memo: '오전 9시까지' }));
    saveOrder(tx, blankOrder({ date: D, zone: 'jeju', kind: 'load', vehicle_id: 'v9915', client_id: 'c-dm', product_id: 'p-gam', quantity: 10, unit: '파렛트' }));
    saveOrder(tx, blankOrder({ date: D, zone: 'jeju', kind: 'load', vehicle_id: 'v9915', client_id: 'c-jr', quantity: 1, unit: '대', night: true }));
    setRowShip(tx, { date: D, vehicle_id: 'v9915', zone: 'jeju', which: 'departure', ship: '제이엘', tag: '' });
    setRowDriver(tx, { date: D, vehicle_id: 'v9915', zone: 'jeju', driver_id: 'dA' });
    setRowNightDriver(tx, { date: D, vehicle_id: 'v9915', zone: 'jeju', driver_id: 'dB' });
    const snap = tx.result();
    const board = buildBoard(snap, D);
    expect(peopleOn(snap, board).map((p) => p.name)).toEqual(['김재표', '최현수']);
    const a = driverDayText(snap, board, D, 'dA');
    expect(a).toContain('김재표 기사님 일정');
    expect(a).toContain('🚚 9915');
    expect(a).toContain('■ 오전');
    expect(a).toContain('1. 신제주운송');
    expect(a).toContain('📝 오전 9시까지');
    expect(a).toContain('■ 오후 (출발 제이엘 16:10)');
    expect(a).toContain('도민물류');
    expect(a).not.toContain('■ 야간');
    const b = driverDayText(snap, board, D, 'dB');
    expect(b).toContain('■ 야간');
    expect(b).toContain('제주로지');
    expect(b).not.toContain('■ 오전');
  });
});
