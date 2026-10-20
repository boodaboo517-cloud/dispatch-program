// 선박: departs_at = 제주 출발(상행) 시간, port_times = 기항지별 하행(육지 → 제주) 출발 시간.
// 선박 칸 값은 "선박명" 또는 "선박명 (기항지)" 문자열로 저장한다.
import type { Ship, Zone } from './types.ts';

export function parseShip(value: string | null | undefined): { name: string; port: string } {
  if (!value) return { name: '', port: '' };
  const m = /^(.*\S)\s*\(([^()]+)\)\s*$/.exec(value);
  return m ? { name: m[1], port: m[2].trim() } : { name: value.trim(), port: '' };
}

export const formatShip = (name: string, port = '') => (port ? `${name} (${port})` : name);

export function findShip(ships: Ship[], value: string | null | undefined): Ship | undefined {
  const { name } = parseShip(value);
  return ships.find((s) => s.name === name);
}

/** 선박 칸 값의 출발 시간: 기항지가 있으면 그 기항지 하행 시간, 없으면 제주 출발 시간 */
export function shipTimeOf(ships: Ship[], value: string | null | undefined): string {
  const { name, port } = parseShip(value);
  if (!name) return '';
  const same = ships.filter((s) => s.name === name);
  if (port) {
    for (const s of same) {
      const t = s.port_times?.find((p) => p.port === port)?.time;
      if (t) return t;
    }
  }
  return same[0]?.departs_at ?? '';
}

export interface ShipChoice {
  value: string;
  label: string;
  time: string;
  ship: Ship;
}

/**
 * 선박 선택 목록.
 * 제주에서 나가는 배(제주 출발 · 육지 상행선박) = 제주 출발 시간,
 * 육지에서 나가는 배(육지 하행선박 · 제주 도착 선박) = 기항지별 하행 시간.
 */
export function shipChoices(ships: Ship[], zone: Zone | null, which: 'arrival' | 'departure'): ShipChoice[] {
  const fromJeju = (zone === 'jeju' && which === 'departure') || (zone === 'land' && which === 'arrival');
  const out: ShipChoice[] = [];
  for (const s of ships) {
    const ports = s.port_times?.filter((p) => p.port) ?? [];
    if (fromJeju || !ports.length) {
      if (fromJeju && s.route === 'down') continue;
      if (!fromJeju && s.route === 'up') continue;
      out.push({ value: s.name, label: s.name, time: s.departs_at, ship: s });
    } else {
      for (const p of ports) out.push({ value: formatShip(s.name, p.port), label: `${s.name} · ${p.port}`, time: p.time, ship: s });
    }
  }
  return out.sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.label.localeCompare(b.label, 'ko'));
}
