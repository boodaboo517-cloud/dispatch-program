// 일정표 한눈에 보기: 한 화면에 육지(위) · 제주(아래). 칸을 누르면 배차 화면과 똑같이 보기·입력된다.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type Board, type Zone } from '../domain/index.ts';
import { exportSchedule } from '../excel/exportSchedule.ts';
import { seoulToday } from '../lib/time.ts';
import { useBoard, useIsWide, useRole, useSnap } from '../ui/hooks.ts';
import { useBoardActions } from '../ui/useBoardActions.tsx';
import { DateBar } from './SchedulePage.tsx';
import { MobileBoard } from './schedule/MobileBoard.tsx';
import { PcBoard } from './schedule/PcBoard.tsx';

const ZONE_TITLE: Record<Zone, string> = { land: '육지', jeju: '제주' };

function ZoneSection({ zone, board, date, actions }: { zone: Zone; board: Board; date: string; actions: ReturnType<typeof useBoardActions> }) {
  const wide = useIsWide();
  const nav = useNavigate();
  const rows = zone === 'land' ? board.land : board.jeju;
  const orders = [...rows.flatMap((r) => [...r.unloads, ...r.loads]), ...board.waiting[zone], ...board.external[zone]];
  const unloads = orders.filter((o) => o.kind === 'unload').length;
  const loads = orders.filter((o) => o.kind === 'load').length;
  const vehicles = rows.filter((r) => !r.secondary).length;
  return (
    <section className={`zone-section ${zone}`}>
      <div className="zone-title">
        <b>{ZONE_TITLE[zone]}</b>
        <span className="small">
          {vehicles}대 · {zone === 'land' ? '하차' : '오전'} {unloads} · {zone === 'land' ? '상차' : '오후'} {loads}
          {board.waiting[zone].length > 0 && <span className="badge warn" style={{ marginLeft: 6 }}>배차대기 {board.waiting[zone].length}</span>}
        </span>
        <button className="ghost small right" onClick={() => nav(`/?date=${date}&zone=${zone}`)}>배차 화면 ›</button>
      </div>
      {wide
        ? <PcBoard zone={zone} rows={rows} waiting={board.waiting[zone]} external={board.external[zone]} actions={actions} focus={null} />
        : <MobileBoard date={date} zone={zone} rows={rows} waiting={board.waiting[zone]} external={board.external[zone]} actions={actions} focus={null} />}
    </section>
  );
}

export function OverviewPage({ embedded }: { embedded?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const [localDate, setLocalDate] = useState(seoulToday());
  // 기사 화면 안에 넣을 때는 주소(URL) 대신 화면 안에서만 날짜를 바꾼다
  const date = embedded ? localDate : params.get('date') ?? seoulToday();
  const setDate = (d: string) => (embedded ? setLocalDate(d) : setParams({ date: d }, { replace: true }));
  const snap = useSnap();
  const board = useBoard(date);
  const actions = useBoardActions(date, board);
  const wide = useIsWide();
  const { staff } = useRole();
  return (
    <div className={embedded ? '' : 'page'}>
      <DateBar date={date} onChange={setDate} />
      <div className="chips">
        <span className="chip">육지 {board.summary.land}대</span>
        <span className="chip">제주 {board.summary.jeju}대</span>
        <span className="chip">공차 {board.summary.empty}</span>
        {board.summary.repair > 0 && <span className="chip alert">수리 {board.summary.repair}</span>}
        {board.summary.waiting > 0 && <span className="chip warn">배차대기 {board.summary.waiting}</span>}
        {board.summary.external > 0 && <span className="chip">용차·화주 {board.summary.external}</span>}
        {wide && staff && <button className="chip" onClick={() => exportSchedule(snap, date, date)}>⬇ 엑셀</button>}
      </div>
      <ZoneSection zone="land" board={board} date={date} actions={actions} />
      <ZoneSection zone="jeju" board={board} date={date} actions={actions} />
    </div>
  );
}
