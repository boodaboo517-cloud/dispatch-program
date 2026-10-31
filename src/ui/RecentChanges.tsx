// 최근 24시간 수정 이력: 칸(줄)별 목록 · 수정 이력 화면 공용
import type { ChangeEntry } from '../data/store.ts';
import { TZ, dayjs } from '../lib/time.ts';
import { useStore } from './hooks.ts';

export const changeTime = (at: string) => dayjs(at).tz(TZ).format('M/D HH:mm:ss');

export function ChangeLine({ c, showTarget = true }: { c: ChangeEntry; showTarget?: boolean }) {
  return (
    <div className="chg-line">
      <div className="chg-head">
        <span className="muted small">{changeTime(c.at)}</span>
        <b>{c.login_id || '-'}</b>
        <span className={`chg-op op-${c.op}`}>{c.op}</span>
        <span className="muted small">{c.screen}</span>
      </div>
      {showTarget && c.target && <div className="small">{c.target}</div>}
      {c.op === '수정' && (
        <div className="chg-diff">
          <span className="k">{c.field_label}</span>
          <span className="before">{c.before || '(빈칸)'}</span> → <span className="after">{c.after || '(빈칸)'}</span>
        </div>
      )}
    </div>
  );
}

/** 이 줄(오더·차량 일정 등)의 최근 24시간 변경 — 칸을 눌렀을 때 화면 안에 */
export function RecentChanges({ ids, title = '🕘 최근 24시간 변경' }: { ids: (string | null | undefined)[]; title?: string }) {
  const changes = useStore((s) => s.changes);
  const want = new Set(ids.filter(Boolean) as string[]);
  const list = changes.filter((c) => c.row_id && want.has(c.row_id));
  if (!list.length) return null;
  return (
    <details className="recent-changes">
      <summary>{title} <span className="badge warn">{list.length}</span> <span className="muted small">(눌러서 보기)</span></summary>
      {list.slice(0, 30).map((c) => <ChangeLine key={c.id} c={c} showTarget={false} />)}
    </details>
  );
}
