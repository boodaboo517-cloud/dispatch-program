import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { buildBoard, buildIndex, type Board, type Role } from '../domain/index.ts';
import { store, type StoreState } from '../data/store.ts';
import { seoulToday } from '../lib/time.ts';

export function useStore<T>(sel: (s: StoreState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.getState()));
}

export const useSnap = () => useStore((s) => s.snap);
export const useSession = () => useStore((s) => s.session);

export function useRole(): { role: Role; staff: boolean; admin: boolean } {
  const role = useStore((s) => s.session?.role ?? 'viewer');
  return { role, staff: role !== 'viewer', admin: role === 'admin' };
}

export function useBoard(date: string): Board {
  const snap = useSnap();
  return useMemo(() => buildBoard(snap, date, buildIndex(snap)), [snap, date]);
}

export function useIsWide() {
  const q = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const fn = () => setWide(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);
  return wide;
}

/** 탭 / 길게 누르기 구분 (500ms) */
export function usePress(onTap: () => void, onLong?: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const long = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    long.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    if (onLong) {
      timer.current = setTimeout(() => {
        long.current = true;
        navigator.vibrate?.(30);
        onLong();
      }, 500);
    }
  }, [onLong]);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear();
  }, []);
  const onClick = useCallback(() => {
    clear();
    if (!long.current) onTap();
    long.current = false;
  }, [onTap]);
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
    onClick,
    onContextMenu: (e: React.MouseEvent) => {
      if (onLong) {
        e.preventDefault();
        if (!long.current) {
          long.current = true;
          onLong();
        }
      }
    },
  };
}

/** 편집 중인 행을 store 에 알려 다른 사람 변경 알림을 받는다 */
/** 이 줄을 화면에 열어 둠: 다른 사람이 바꾸면 알림 + 다른 사람 화면에 "편집 중" 표시 */
export function useWatch(id: string | null | undefined) {
  useEffect(() => {
    if (!id) return;
    store.watched.add(id);
    store.setEditing(id);
    return () => {
      store.watched.delete(id);
      if (!store.watched.size) store.setEditing(null);
    };
  }, [id]);
}

/** 보고 있는 날짜가 오늘이면 화면 바탕(표 바깥)을 아주 연한 노란색으로 — 오늘 일정인지 바로 알아보게 */
export function useTodayTint(date: string, on = true) {
  useEffect(() => {
    const today = on && date === seoulToday();
    document.body.classList.toggle('today-view', today);
    return () => document.body.classList.remove('today-view');
  }, [date, on]);
}
