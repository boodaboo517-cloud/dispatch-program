import { describe, expect, it } from 'vitest';
import { shipChoices, shipDepart, shipSortTime, shipTimeLabel } from '../ships.ts';
import type { Ship } from '../types.ts';

const ship = (name: string, p: Partial<Ship> = {}): Ship =>
  ({ id: name, name, departs_at: '', route: 'both', arrival_day_offset: 1, sort_order: 0, port_times: [], ...p }) as Ship;

describe('선박 출발 지역 · 당일/익일', () => {
  const ships = [
    ship('퀸메리', { departs_at: '08:30', port_times: [{ port: '목포', time: '01:00', next_day: true }] }),
    ship('성우', { departs_at: '16:40', depart_port: '서귀포' }),
    ship('대양', { departs_at: '00:30', depart_next_day: true }),
  ];
  it('익일이면 "익일 01:00", 정렬은 하루 뒤로', () => {
    expect(shipTimeLabel(ships, '퀸메리 (목포)')).toBe('익일 01:00');
    expect(shipSortTime(ships, '퀸메리 (목포)')).toBe('25:00');
    expect(shipTimeLabel(ships, '퀸메리')).toBe('08:30');
    expect(shipDepart(ships, '성우')).toEqual({ time: '16:40', nextDay: false, port: '서귀포' });
  });
  it('선박 고르기 목록: 제주 쪽 출발 항구 표시, 익일 출발은 맨 뒤', () => {
    const jeju = shipChoices(ships, 'jeju', 'departure');
    expect(jeju.map((c) => c.label)).toEqual(['퀸메리', '성우 · 서귀포', '대양']);
    expect(jeju[2].nextDay).toBe(true);
  });
});
