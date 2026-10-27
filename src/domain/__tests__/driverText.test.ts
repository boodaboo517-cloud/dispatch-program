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
      { id: 'dA', name: '김재표', work_days: [], shift: '', staff_type: '기사' } as never,
      { id: 'dB', name: '최현수', work_days: [], shift: '', staff_type: '기사' } as never,
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
    expect(a.split('\n')[0]).toBe('10/20(화) 김재표');
    expect(a).toContain('9915');
    expect(a).toContain('■ 오전 일정');
    expect(a).toContain('1. 신제주운송');
    expect(a).toContain('   오전 9시까지');
    expect(a).toContain('■ 오후 일정');
    expect(a).toContain('도민물류');
    expect(a).not.toContain('■ 야간');
    // 마감 선박은 맨 밑에 출발 시간
    expect(a.trim().split('\n').pop()).toBe('제이엘(제주출발) 16시10분');
    expect(a).not.toMatch(/[🚚📝⏰📍🙏]/u);
    const b = driverDayText(snap, board, D, 'dB');
    expect(b).toContain('■ 야간 일정');
    expect(b).toContain('제주로지');
    expect(b).not.toContain('■ 오전');
  });
  it('괄호까지 이름으로 등록된 배는 출항·출발을 겹쳐 붙이지 않고, 출발 시간도 나온다', () => {
    const s = baseSnapshot();
    s.drivers = [{ id: 'dA', name: '강기성', work_days: [], shift: '', staff_type: '기사' } as never];
    s.ships.push(
      { id: 's1', name: '제이엘오션(목포출항)', departs_at: '', route: 'both', arrival_day_offset: 1, sort_order: 5 },
      { id: 's2', name: '제이엘오션(제주출발)', departs_at: '16:10', route: 'both', arrival_day_offset: 1, sort_order: 6 },
    );
    const tx = new Tx(s);
    saveOrder(tx, blankOrder({ date: D, zone: 'jeju', kind: 'unload', vehicle_id: 'v9915', client_id: 'c-sin', arrival_ship: '제이엘오션(목포출항) (목포)' }));
    saveOrder(tx, blankOrder({ date: D, zone: 'jeju', kind: 'load', vehicle_id: 'v9915', client_id: 'c-dm' }));
    setRowShip(tx, { date: D, vehicle_id: 'v9915', zone: 'jeju', which: 'arrival', ship: '제이엘오션(목포출항) (목포)', tag: '대한물류 예약' as never });
    setRowShip(tx, { date: D, vehicle_id: 'v9915', zone: 'jeju', which: 'departure', ship: '제이엘오션(제주출발)', tag: '' });
    setRowDriver(tx, { date: D, vehicle_id: 'v9915', zone: 'jeju', driver_id: 'dA' });
    const snap = tx.result();
    const t = driverDayText(snap, buildBoard(snap, D), D, 'dA');
    expect(t).toContain('도착 제이엘오션(목포출항)\n'); // 예약해 준 업체 표시는 빼고
    expect(t).not.toContain('대한물류');
    expect(t.trim().split('\n').pop()).toBe('제이엘오션(제주출발) 16시10분');
    // 항구만 적힌 보통 배
    expect(driverDayText(snap, buildBoard(snap, D), D, 'dA')).not.toContain('출항)(');
  });
  it('휴무자도 목록에 나오고 문자는 "휴무"', () => {
    const s = baseSnapshot();
    s.drivers = [{ id: 'dA', name: '김재표', work_days: [], shift: '', staff_type: '기사' } as never];
    s.field_assignments = [{ id: 'f1', date: D, staff_id: 'dA', is_off: true, site_id: null, task: '휴무', vehicle_id: null, sort_order: 0 } as never];
    const board = buildBoard(s, D);
    expect(peopleOn(s, board)).toEqual([{ id: 'dA', name: '김재표', what: '휴무', group: '휴무' }]);
    expect(driverDayText(s, board, D, 'dA')).toBe('10/20(화) 김재표\n\n휴무');
  });
});
