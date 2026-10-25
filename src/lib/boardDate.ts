// 배차 화면에서 보고 있는 날짜·구역 → 오더 입력의 기본값 (오늘이 지나면 버림)
import { seoulToday } from './time.ts';

const KEY = 'board-view';

export function rememberBoardView(date: string, zone: string) {
  try { localStorage.setItem(KEY, JSON.stringify({ date, zone, day: seoulToday() })); } catch { /* 저장 안 되면 오늘로 */ }
}

export function boardView(): { date: string; zone: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && v.day === seoulToday() && typeof v.date === 'string' ? { date: v.date, zone: v.zone } : null;
  } catch { return null; }
}
