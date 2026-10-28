// 선박: departs_at = 제주 출발(상행) 시간, port_times = 기항지별 하행(육지 → 제주) 출발 시간.
// 선박 칸 값은 "선박명" 또는 "선박명 (기항지)" 문자열로 저장한다.
import type { Ship, Zone } from './types.ts';

export function parseShip(value: string | null | undefined): { name: string; port: string } {
  if (!value) return { name: '', port: '' };
  const m = /^(.*\S)\s*\(([^()]+)\)\s*$/.exec(value);
  return m ? { name: m[1], port: m[2].trim() } : { name: value.trim(), port: '' };
}

/** 선박 칸이 "대기"면 배를 타지 않음 → 다음 날도 그 지역에 그대로 */
export const isWaitShip = (value: string | null | undefined) => !!value && value.includes('대기');

/** 선박 칸이 "익일선적"이면 오늘 출발이 아니라 다음 날 선적 → 그다음 날 도착 (도착 +2일, 다음 날까지는 이 지역) */
export const isNextDayShip = (value: string | null | undefined) => !!value && /익일\s*선적/.test(value);
/** 출발까지 미뤄지는 날 수 (익일선적 1, 보통 0) */
export const departDelay = (value: string | null | undefined) => (isNextDayShip(value) ? 1 : 0);

export const formatShip = (name: string, port = '') => (port ? `${name} (${port})` : name);

export function findShip(ships: Ship[], value: string | null | undefined): Ship | undefined {
  // "제이엘오션(제주출발)"처럼 괄호까지 이름으로 등록된 배는 이름 그대로 먼저
  const whole = value?.trim();
  const exact = whole ? ships.find((s) => s.name === whole) : undefined;
  if (exact) return exact;
  const { name } = parseShip(value);
  return ships.find((s) => s.name === name);
}

/** 벌크 선박(차량은 안 타고 화물만): 선박 등록에서 벌크로 정했거나 이름에 "벌크"가 들어간 배 */
export function isBulkShip(ships: Ship[], value: string | null | undefined): boolean {
  if (!value || isWaitShip(value)) return false;
  return !!findShip(ships, value)?.bulk || parseShip(value).name.includes('벌크');
}

/** 선박 칸 값의 출발 정보: 시간(HH:mm) · 익일 여부 · 출발 항구 */
export function shipDepart(ships: Ship[], value: string | null | undefined): { time: string; nextDay: boolean; port: string } {
  const whole = value?.trim();
  const exact = whole ? ships.find((s) => s.name === whole) : undefined;
  const jeju = (s: Ship | undefined) => ({ time: s?.departs_at ?? '', nextDay: !!s?.depart_next_day, port: s?.depart_port?.trim() || '제주' });
  if (exact) return jeju(exact);
  const { name, port } = parseShip(value);
  if (!name) return { time: '', nextDay: false, port: '' };
  const same = ships.filter((s) => s.name === name);
  if (port) {
    for (const s of same) {
      const p = s.port_times?.find((x) => x.port === port);
      if (p?.time) return { time: p.time, nextDay: !!p.next_day, port };
    }
  }
  return jeju(same[0]);
}

/** 화면에 보이는 출발 시간: 익일이면 "익일 01:00" */
export function shipTimeLabel(ships: Ship[], value: string | null | undefined): string {
  const d = shipDepart(ships, value);
  return d.time ? `${d.nextDay ? '익일 ' : ''}${d.time}` : '';
}

/** 정렬용 시간: 익일 출발은 하루 뒤로 (01:00 익일 → 25:00) */
export function shipSortTime(ships: Ship[], value: string | null | undefined): string {
  const d = shipDepart(ships, value);
  if (!d.time) return '';
  if (!d.nextDay) return d.time;
  const [h, m] = d.time.split(':');
  return `${String(Number(h) + 24).padStart(2, '0')}:${m ?? '00'}`;
}

/** 선박 칸 값의 출발 시간: 기항지가 있으면 그 기항지 하행 시간, 없으면 제주 출발 시간 */
export function shipTimeOf(ships: Ship[], value: string | null | undefined): string {
  const whole = value?.trim();
  const exact = whole ? ships.find((s) => s.name === whole) : undefined;
  if (exact) return exact.departs_at ?? '';
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
  /** 익일 출발 */
  nextDay: boolean;
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
      const port = s.depart_port?.trim();
      out.push({ value: s.name, label: port && port !== '제주' && fromJeju ? `${s.name} · ${port}` : s.name, time: s.departs_at, nextDay: !!s.depart_next_day, ship: s });
    } else {
      for (const p of ports) out.push({ value: formatShip(s.name, p.port), label: `${s.name} · ${p.port}`, time: p.time, nextDay: !!p.next_day, ship: s });
    }
  }
  const key = (c: ShipChoice) => (c.time ? (c.nextDay ? `${Number(c.time.slice(0, 2)) + 24}${c.time.slice(2)}` : c.time) : '99');
  return out.sort((a, b) => key(a).localeCompare(key(b)) || a.label.localeCompare(b.label, 'ko'));
}

/**
 * 선박 표시 글자: 기본 표시(아침/예약/야간) + 예약해 준 업체.
 * 예) ('야간', '대한물류') → "야간 · 대한물류 예약", ('', '대한물류') → "대한물류 예약"
 */
export function composeShipTag(base: string, booker: string): string {
  const b = booker.trim();
  if (!b) return base;
  const head = base && base !== '예약' ? `${base} · ` : '';
  return `${head}${b} 예약`;
}

export function splitShipTag(tag: string | null | undefined): { base: string; booker: string } {
  if (!tag) return { base: '', booker: '' };
  const m = /^(?:(.+?) · )?(.+) 예약$/.exec(tag);
  if (m && m[2] !== '') return { base: m[1] ?? '', booker: m[2] };
  return { base: tag, booker: '' };
}
