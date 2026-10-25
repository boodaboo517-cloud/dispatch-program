// 일정표 한눈에 보기 (확인용): 종이 일정표처럼 한 화면에 육지(위) · 제주(아래). 수정은 배차 화면에서.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { exportSchedule } from '../excel/exportSchedule.ts';
import { seoulToday } from '../lib/time.ts';
import { boardView, rememberBoardDate } from '../lib/boardDate.ts';
import { useBoard, useIsWide, useRole, useSnap } from '../ui/hooks.ts';
import { useSwipe } from '../ui/useSwipe.ts';
import { addDays } from '../domain/index.ts';
import { setting } from '../ui/labels.ts';
import { DateBar } from './SchedulePage.tsx';
import { SheetBoard, SheetExtras } from './schedule/SheetBoard.tsx';

export function OverviewPage({ embedded }: { embedded?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const [localDate, setLocalDate] = useState(seoulToday());
  // 기사 화면 안에 넣을 때는 주소(URL) 대신 화면 안에서만 날짜를 바꾼다
  const date = embedded ? localDate : params.get('date') ?? boardView()?.date ?? seoulToday();
  const setDate = (d: string) => (embedded ? setLocalDate(d) : setParams({ date: d }, { replace: true }));
  // 오더 입력을 열면 이 날짜가 기본으로 (기사 화면 안 전체 일정은 제외)
  useEffect(() => { if (!embedded) rememberBoardDate(date); }, [date, embedded]);
  const snap = useSnap();
  const board = useBoard(date);
  const wide = useIsWide();
  const { staff } = useRole();
  // 휴대폰: 왼쪽으로 밀면 다음 날, 오른쪽으로 밀면 전날
  const swipe = useSwipe((dir) => setDate(addDays(date, dir)));
  return (
    <div className={`paper-page ${embedded ? '' : 'page'}`} {...(wide ? {} : swipe)}>
      <div className="paper-title">{setting(snap, 'header_notice', '경민물류 일정표')}</div>
      <DateBar date={date} onChange={setDate} />
      <SheetBoard zone="land" date={date} rows={board.land} waiting={board.waiting.land} external={board.external.land} field={board.field} />
      <SheetBoard zone="jeju" date={date} rows={board.jeju} waiting={board.waiting.jeju} external={board.external.jeju} field={board.field} />
      <SheetExtras date={date} field={board.field} />
      {wide && staff && (
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="chip" onClick={() => exportSchedule(snap, date, date)}>⬇ 엑셀</button>
        </div>
      )}
    </div>
  );
}
