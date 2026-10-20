import type { ReactNode } from 'react';
import { usePress } from './hooks.ts';

/** 일정표 한 칸: 빈칸 탭 → 목록, 내용 있는 칸 탭 → 전체 보기, 길게 → 수정 */
export function Cell(p: {
  className?: string;
  onTap: () => void;
  onLong?: () => void;
  children?: ReactNode;
  title?: string;
  draggableId?: string;
}) {
  const h = usePress(p.onTap, p.onLong);
  return (
    <div
      className={`cell ${p.className ?? ''}`}
      {...h}
      title={p.title}
      role="button"
      draggable={!!p.draggableId}
      onDragStart={p.draggableId ? (e) => e.dataTransfer.setData('text/order', p.draggableId!) : undefined}
    >
      {p.children}
    </div>
  );
}
