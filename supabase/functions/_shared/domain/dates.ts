// 순수 날짜 계산 (YYYY-MM-DD 문자열). 시간대와 무관하게 동작하도록 UTC 로만 계산한다.
// "오늘" 은 화면에서 Asia/Seoul 기준으로 구해 넘겨준다 (src/lib/time.ts).
import type { Weekday } from './types.ts';

function toUtc(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function fmt(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const dt = toUtc(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

export function weekdayOf(d: string): Weekday {
  return toUtc(d).getUTCDay() as Weekday;
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(a).getTime() - toUtc(b).getTime()) / 86400000);
}

export function* eachDay(from: string, to: string): Generator<string> {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

export const maxDate = (a: string, b: string) => (a > b ? a : b);
export const minDate = (a: string, b: string) => (a < b ? a : b);

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;
/** 화면 표시 순서 월~일 */
export const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export function weekdaysLabel(days: Weekday[]): string {
  return WEEKDAY_ORDER.filter((d) => days.includes(d)).map((d) => WEEKDAY_LABELS[d]).join('');
}

export function inRange(d: string, from: string, to: string | null): boolean {
  return d >= from && (to === null || d <= to);
}
