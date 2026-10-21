import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, type Zone } from '../domain/index.ts';
import { exportSchedule } from '../excel/exportSchedule.ts';
import { fmtLong, fmtStamp, seoulToday } from '../lib/time.ts';
import { useBoard, useIsWide, useRole, useSnap, useStore } from '../ui/hooks.ts';
import { setting } from '../ui/labels.ts';
import { useBoardActions } from '../ui/useBoardActions.tsx';
import { FieldTab } from './schedule/FieldTab.tsx';
import { MobileBoard } from './schedule/MobileBoard.tsx';
import { PcBoard } from './schedule/PcBoard.tsx';
import { ReorderPanel } from './schedule/ReorderPanel.tsx';

type Tab = Zone | 'field' | 'waiting';
type Filter = 'all' | 'empty' | 'repair' | 'waiting' | 'nodriver';

export function DateBar({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  return (
    <div className="datebar">
      <button onClick={() => onChange(addDays(date, -1))}>◀ 전일</button>
      <div className="date">
        <label style={{ cursor: 'pointer' }}>
          {fmtLong(date)}
          <input type="date" value={date} onChange={(e) => e.target.value && onChange(e.target.value)} style={{ position: 'absolute', opacity: 0, width: 1 }} />
        </label>
        {date !== seoulToday() && <button className="ghost small" onClick={() => onChange(seoulToday())}>오늘</button>}
      </div>
      <button onClick={() => onChange(addDays(date, 1))}>익일 ▶</button>
    </div>
  );
}

export function SchedulePage({ readOnlyHeader }: { readOnlyHeader?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const date = params.get('date') ?? seoulToday();
  const tab = (params.get('zone') as Tab) ?? 'land';
  const focusParam = params.get('focus');
  const [filter, setFilter] = useState<Filter>('all');
  const [reorder, setReorder] = useState(false);
  const [focus, setFocus] = useState<string | null>(focusParam);
  const snap = useSnap();
  const savedAt = useStore((st) => st.savedAt);
  const board = useBoard(date);
  const wide = useIsWide();
  const { staff } = useRole();
  const actions = useBoardActions(date, board, (vid) => setFocus(vid));

  const update = (p: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(p)) v === null ? next.delete(k) : next.set(k, v);
    setParams(next, { replace: true });
  };

  useEffect(() => setFocus(focusParam), [focusParam]);
  const focusRowId = useMemo(() => {
    if (!focus) return null;
    const o = snap.daily_orders.find((x) => x.id === focus);
    return o ? o.vehicle_id ?? o.id : focus;
  }, [focus, snap]);
  useEffect(() => {
    if (!focusRowId) return;
    const t = setTimeout(() => document.getElementById(`row-${focusRowId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    const clear = setTimeout(() => setFocus(null), 4000);
    return () => {
      clearTimeout(t);
      clearTimeout(clear);
    };
  }, [focusRowId, tab, date]);

  const zone: Zone | null = tab === 'land' || tab === 'jeju' ? tab : null;
  const rows = useMemo(() => {
    if (!zone) return [];
    const base = zone === 'land' ? board.land : board.jeju;
    if (filter === 'empty') return base.filter((r) => r.status === 'empty');
    if (filter === 'repair') return base.filter((r) => r.status === 'repair');
    if (filter === 'nodriver') return base.filter((r) => r.unloads.length + r.loads.length > 0 && !r.driverId);
    if (filter === 'waiting') return [];
    return base;
  }, [board, zone, filter]);
  const waiting = zone ? board.waiting[zone] : [];
  const external = zone && filter !== 'waiting' ? board.external[zone] : [];
  const s = board.summary;
  const linkPending = board.rows.filter((r) => r.linkPending || r.shipPending).length;
  const Chip = (p: { on: boolean; onClick: () => void; children: React.ReactNode; cls?: string }) => (
    <button className={`chip ${p.cls ?? ''} ${p.on ? 'on' : ''}`} onClick={p.onClick}>{p.children}</button>
  );

  return (
    <div className="page">
      {!readOnlyHeader && (
        <div className="muted" style={{ textAlign: 'center' }}>
          {setting(snap, 'header_notice', '경민물류 일정표')}
          {savedAt && <span className="small" style={{ color: 'var(--green)' }}> · ✓ 자동 저장됨 {fmtStamp(savedAt).split(' ')[1]}</span>}
        </div>
      )}
      <DateBar date={date} onChange={(d) => update({ date: d, focus: null })} />
      <div className="tabs">
        {(['land', 'jeju', 'field', 'waiting'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => { update({ zone: t }); setFilter('all'); }}>
            {{ land: '육지', jeju: '제주', field: '현장근무', waiting: `미배차${s.waiting ? ` ${s.waiting}` : ''}` }[t]}
          </button>
        ))}
      </div>
      <div className="chips">
        <Chip on={tab === 'land' && filter === 'all'} onClick={() => { update({ zone: 'land' }); setFilter('all'); }}>육지 {s.land}대</Chip>
        <Chip on={tab === 'jeju' && filter === 'all'} onClick={() => { update({ zone: 'jeju' }); setFilter('all'); }}>제주 {s.jeju}대</Chip>
        <Chip on={filter === 'empty'} onClick={() => setFilter(filter === 'empty' ? 'all' : 'empty')}>공차 {s.empty}</Chip>
        <Chip on={filter === 'repair'} cls={s.repair ? 'alert' : ''} onClick={() => setFilter(filter === 'repair' ? 'all' : 'repair')}>수리 {s.repair}</Chip>
        <Chip on={filter === 'waiting'} cls={s.waiting ? 'warn' : ''} onClick={() => setFilter(filter === 'waiting' ? 'all' : 'waiting')}>배차대기 {s.waiting}</Chip>
        <Chip on={tab === 'field'} onClick={() => update({ zone: 'field' })}>현장 {s.field}</Chip>
        {s.external > 0 && <span className="chip">용차·화주 {s.external}</span>}
        {s.noDriver > 0 && <Chip on={filter === 'nodriver'} cls="alert" onClick={() => setFilter(filter === 'nodriver' ? 'all' : 'nodriver')}>기사 미지정 {s.noDriver}</Chip>}
        <span className="chip">하차 {s.unloads} · 상차 {s.loads}</span>
        {staff && zone && <button className={`chip${reorder ? ' on' : ''}`} onClick={() => setReorder(!reorder)}>↕ 줄 순서</button>}
        {wide && <button className="chip" onClick={() => exportSchedule(snap, date, date)}>⬇ 엑셀</button>}
      </div>
      {board.unknownLocation.length > 0 && (
        <div className="banner red">⚠ 위치 미정 차량 {board.unknownLocation.map((v) => v.short_no).join(', ')} — 등록 대수 {s.registered}대 중 {s.land + s.jeju}대만 표시됩니다. 차량 상태에서 위치를 지정하세요.</div>
      )}
      {staff && linkPending > 0 && <div className="banner yellow">원본 상차·전날 선박이 바뀐 줄 {linkPending}건 — "!" / "변경?" 표시를 눌러 반영 또는 무시하세요.</div>}

      {zone && (wide
        ? (reorder ? <ReorderPanel rows={rows} onDone={() => setReorder(false)} /> : <PcBoard zone={zone} rows={rows} waiting={waiting} external={external} actions={actions} focus={focus} />)
        : (reorder ? <ReorderPanel rows={rows} onDone={() => setReorder(false)} /> : <MobileBoard date={date} zone={zone} rows={rows} waiting={waiting} external={external} actions={actions} focus={focus} />))}
      {tab === 'field' && <FieldTab date={date} />}
      {tab === 'waiting' && (
        <>
          {(['land', 'jeju'] as Zone[]).map((z) => (
            <div key={z}>
              <h3>{z === 'land' ? '육지' : '제주'} 배차 대기 {board.waiting[z].length}건</h3>
              {board.waiting[z].length ? (
                wide
                  ? <PcBoard zone={z} rows={[]} waiting={board.waiting[z]} actions={actions} focus={focus} />
                  : <MobileBoard date={date} zone={z} rows={[]} waiting={board.waiting[z]} actions={actions} focus={focus} />
              ) : <p className="muted">없음</p>}
            </div>
          ))}
          <p className="muted">노란 차량 칸을 누르면 그날 그 지역 차량 목록이 뜹니다. PC에서는 육지·제주 탭에서 끌어다 차량 줄에 놓을 수도 있습니다.</p>
        </>
      )}
      {staff && <button className="fab" aria-label="오더 추가" onClick={() => nav(`/order?date=${date}&zone=${zone ?? 'land'}`)}>＋</button>}
    </div>
  );
}
