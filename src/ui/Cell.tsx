import type { ReactNode } from 'react';
import { store } from '../data/store.ts';
import { usePress, useStore } from './hooks.ts';

/** 최근 24시간 안에 바뀐 칸인지: 줄 id + (있으면) 그 칸에 해당하는 항목들 */
export type ChangedKey = { id: string | null | undefined; fields?: string[] };

export function useChanged(k?: ChangedKey) {
  return useStore((s) => {
    if (!k?.id) return false;
    const f = s.changedRows.get(k.id);
    if (!f) return false;
    return !k.fields || f.has('') || k.fields.some((x) => f.has(x));
  });
}

/** 다른 사람이 지금 이 줄을 편집 중이면 그 사람 아이디 */
export function useEditors(id: string | null | undefined) {
  return useStore(() => store.editorsOf(id).join(', '));
}

/** 일정표 한 칸: 빈칸 탭 → 목록, 내용 있는 칸 탭 → 전체 보기, 길게 → 수정 */
export function Cell(p: {
  className?: string;
  onTap: () => void;
  onLong?: () => void;
  children?: ReactNode;
  title?: string;
  draggableId?: string;
  /** 최근 24시간 안에 바뀌었으면 오른쪽 위에 작은 점 */
  changed?: ChangedKey;
}) {
  const h = usePress(p.onTap, p.onLong);
  const changed = useChanged(p.changed);
  const editors = useEditors(p.changed?.id);
  return (
    <div
      className={`cell ${p.className ?? ''}${changed ? ' changed' : ''}${editors ? ' editing' : ''}`}
      {...h}
      title={changed ? `${p.title ? `${p.title} · ` : ''}최근 24시간 안에 수정됨` : p.title}
      role="button"
      draggable={!!p.draggableId}
      onDragStart={p.draggableId ? (e) => e.dataTransfer.setData('text/order', p.draggableId!) : undefined}
    >
      {p.children}
      {editors && <span className="editing-by">✏ {editors}</span>}
    </div>
  );
}
