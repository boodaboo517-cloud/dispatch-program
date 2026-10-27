// 일정표 한눈에 보기 (확인용): 종이 일정표처럼 한 화면에 육지(위) · 제주(아래). 수정은 배차 화면에서.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { exportSchedule } from '../excel/exportSchedule.ts';
import { dayjs, seoulToday } from '../lib/time.ts';
import { makeImages, shareImage, type SavedImage } from '../lib/shareImage.ts';
import { boardView, rememberBoardDate } from '../lib/boardDate.ts';
import { useBoard, useIsWide, useRole, useSnap } from '../ui/hooks.ts';
import { useSwipe } from '../ui/useSwipe.ts';
import { addDays } from '../domain/index.ts';
import { setting } from '../ui/labels.ts';
import { DateBar } from './SchedulePage.tsx';
import { SheetBoard, SheetExtras } from './schedule/SheetBoard.tsx';
import { DriverTextButton } from './schedule/DriverTextSheet.tsx';

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
  // 이미지로 저장·공유할 부분: 제목 · 날짜 · 육지 · 제주 · 현장 (버튼은 빼고)
  const sheetRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const title = setting(snap, 'header_notice', '경민물류 일정표');
  const fileName = `경민물류 일정표 ${dayjs(date).format('YYYY-MM-DD(dd)')}`;
  const label = `${title} ${dayjs(date).format('M월 D일 (dd)')}`;
  // 이미지 저장: 육지 · 제주 · 현장 저장 버튼 (하나씩 눌러서 받기)
  const [saved, setSaved] = useState<SavedImage[]>([]);
  const clearSaved = () => { saved.forEach((x) => URL.revokeObjectURL(x.url)); setSaved([]); };
  useEffect(() => clearSaved, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const savedRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (saved.length) savedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [saved]);
  const run = async (f: (el: HTMLElement) => Promise<void>) => {
    if (!sheetRef.current || busy) return;
    setBusy(true);
    try { await f(sheetRef.current); } finally { setBusy(false); }
  };
  return (
    <div className={`paper-page ${embedded ? '' : 'page'}`} {...(wide ? {} : swipe)}>
      <div ref={sheetRef} className="paper-capture">
        <div className="paper-title">{title}</div>
        <DateBar date={date} onChange={setDate} />
        <SheetBoard zone="land" date={date} rows={board.land} waiting={board.waiting.land} external={board.external.land} field={board.field} />
        <SheetBoard zone="jeju" date={date} rows={board.jeju} waiting={board.waiting.jeju} external={board.external.jeju} field={board.field} />
        <SheetExtras date={date} field={board.field} />
      </div>
      <div className="paper-share">
        <button disabled={busy} onClick={() => run(async (el) => { clearSaved(); setSaved(await makeImages(el, fileName, label)); })}>🖼 이미지 저장</button>
        <button disabled={busy} className="kakao" onClick={() => run(async (el) => { clearSaved(); setSaved(await shareImage(el, fileName, label)); })}>💬 카톡 공유</button>
        {wide && staff && <button onClick={() => exportSchedule(snap, date, date)}>⬇ 엑셀</button>}
      </div>
      {staff && <DriverTextButton board={board} date={date} />}
      {busy && <p className="muted small" style={{ textAlign: 'center' }}>이미지 만드는 중…</p>}
      {saved.length > 0 && (
        <div ref={savedRef} className="card paper-saved">
          <div className="row" style={{ alignItems: 'center' }}>
            <b className="grow">이미지 {saved.length}장 · 눌러서 저장</b>
            <button className="ghost" aria-label="닫기" onClick={clearSaved}>✕</button>
          </div>
          <div className="paper-saved-list">
            {saved.map((x) => <a key={x.url} className="btn" href={x.url} download={x.name}>⬇ {x.part}</a>)}
          </div>
        </div>
      )}
    </div>
  );
}
