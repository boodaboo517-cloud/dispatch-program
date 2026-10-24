import { useRef } from 'react';

/**
 * 좌우로 밀기 (휴대폰). 왼쪽으로 밀면 1, 오른쪽으로 밀면 -1.
 * 옆으로 스크롤되는 칸(표) 안에서 민 경우는 그 칸이 끝까지 가서 더 안 움직일 때만 넘긴다.
 */
export function useSwipe(onSwipe: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number; t: number; scroller: HTMLElement | null; left: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) { start.current = null; return; }
      const t = e.touches[0];
      let el = e.target as HTMLElement | null;
      let scroller: HTMLElement | null = null;
      while (el && el !== e.currentTarget) {
        if (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX)) { scroller = el; break; }
        el = el.parentElement;
      }
      start.current = { x: t.clientX, y: t.clientY, t: Date.now(), scroller, left: scroller?.scrollLeft ?? 0 };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      if (s.scroller && Math.abs(s.scroller.scrollLeft - s.left) > 1) return; // 표를 옆으로 넘긴 것
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - s.t < 800) onSwipe(dx < 0 ? 1 : -1);
    },
  };
}
