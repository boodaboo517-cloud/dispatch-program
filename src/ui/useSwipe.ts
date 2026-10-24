import { useRef } from 'react';

/** 좌우로 밀기 (휴대폰). 왼쪽으로 밀면 1, 오른쪽으로 밀면 -1. 옆으로 스크롤되는 칸 안에서 시작한 밀기는 무시 */
export function useSwipe(onSwipe: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      let el = e.target as HTMLElement | null;
      while (el && el !== e.currentTarget) {
        if (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX)) { start.current = null; return; }
        el = el.parentElement;
      }
      start.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - s.t < 800) onSwipe(dx < 0 ? 1 : -1);
    },
  };
}
