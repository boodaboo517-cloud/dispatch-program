// 수정 이력 (최근 24시간, 조회 전용): 최신순 · 아이디·화면·구분으로 거르기 · 엑셀
import { useEffect, useMemo, useState } from 'react';
import { store } from '../data/store.ts';
import { isDemo } from '../data/supabase.ts';
import { exportChanges } from '../excel/exportOther.ts';
import { useStore } from '../ui/hooks.ts';
import { ManageTabs } from '../ui/ManageTabs.tsx';
import { ChangeLine } from '../ui/RecentChanges.tsx';

const PAGE = 200;

export function HistoryPage() {
  const changes = useStore((s) => s.changes);
  const [who, setWho] = useState('');
  const [screen, setScreen] = useState('');
  const [op, setOp] = useState('');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const reload = async () => {
    setLoading(true);
    await store.loadChanges();
    setLoading(false);
  };
  useEffect(() => { void reload(); }, []);
  const ids = useMemo(() => [...new Set(changes.map((c) => c.login_id))].sort(), [changes]);
  const screens = useMemo(() => [...new Set(changes.map((c) => c.screen))].sort(), [changes]);
  const list = useMemo(() => changes.filter((c) =>
    (!who || c.login_id === who) && (!screen || c.screen === screen) && (!op || c.op === op)
    && (!q || `${c.target} ${c.field_label} ${c.before} ${c.after}`.includes(q))), [changes, who, screen, op, q]);
  return (
    <div className="page">
      <ManageTabs />
      <div className="row"><h2 className="grow">🕘 수정 이력</h2>
        <button onClick={() => void reload()} disabled={loading}>{loading ? '불러오는 중…' : '새로고침'}</button>
        <button className="primary" disabled={!list.length} onClick={() => void exportChanges(list)}>📥 엑셀</button>
      </div>
      <p className="muted small">최근 24시간 동안 누가 무엇을 바꿨는지 서버가 자동으로 기록합니다. 24시간이 지나면 자동으로 지워지며, 누구도 고치거나 지울 수 없습니다.</p>
      {isDemo && <div className="banner yellow">데모 모드에서는 수정 이력이 기록되지 않습니다.</div>}
      <div className="row wrap" style={{ gap: 6 }}>
        <select style={{ width: 'auto' }} value={who} onChange={(e) => setWho(e.target.value)}><option value="">아이디 전체</option>{ids.map((x) => <option key={x} value={x}>{x || '(없음)'}</option>)}</select>
        <select style={{ width: 'auto' }} value={screen} onChange={(e) => setScreen(e.target.value)}><option value="">화면 전체</option>{screens.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select style={{ width: 'auto' }} value={op} onChange={(e) => setOp(e.target.value)}><option value="">구분 전체</option>{['등록', '수정', '삭제'].map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <input style={{ flex: 1, minWidth: 140 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색 (차량번호·거래처·값)" />
      </div>
      <div className="muted small" style={{ margin: '6px 0' }}>{list.length}건</div>
      <div className="card">
        {list.length ? list.slice(0, shown).map((c) => <ChangeLine key={c.id} c={c} />) : <p className="muted">기록이 없습니다.</p>}
        {list.length > shown && <button style={{ width: '100%' }} onClick={() => setShown(shown + PAGE)}>더 보기 ({list.length - shown}건 남음)</button>}
      </div>
    </div>
  );
}
