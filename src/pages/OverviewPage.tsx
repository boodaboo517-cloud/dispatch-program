// 일정표 한눈에 보기 (확인용): 종이 일정표처럼 한 화면에 육지(위) · 제주(아래). 수정은 배차 화면에서.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { exportSchedule } from '../excel/exportSchedule.ts';
import { dayjs, seoulToday } from '../lib/time.ts';
import { makeImages, releaseImages, saveImages, shareImages, type SavedImage } from '../lib/shareImage.ts';
import { store } from '../data/store.ts';
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
  // 이미지로 저장·공유할 부분: 제목 · 날짜 · 육지 · 제주 · 현장 (버튼은 빼고)
  const sheetRef = useRef<HTMLDivElement>(null);
  const title = setting(snap, 'header_notice', '경민물류 일정표');
  const fileName = `경민물류 일정표 ${dayjs(date).format('YYYY-MM-DD(dd)')}`;
  const label = `${title} ${dayjs(date).format('M월 D일 (dd)')}`;
  // 이미지 3장은 일정표가 그려진 뒤 미리 만들어 둔다: 휴대폰은 누른 순간에 시작한 다운로드·공유만 허용하므로
  // 누르면 기다림 없이 바로 3장 저장 / 공유 창
  const ready = useRef<{ snap: typeof snap; date: string; title: string; imgs: SavedImage[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      if (!sheetRef.current) return;
      try {
        const imgs = await makeImages(sheetRef.current, fileName, label);
        if (!alive) return releaseImages(imgs);
        if (ready.current) releaseImages(ready.current.imgs);
        ready.current = { snap, date, title, imgs };
      } catch {
        // 미리 만들기 실패: 누를 때 다시 만든다
      }
    }, 1200);
    return () => { alive = false; clearTimeout(t); };
  }, [snap, date, title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (ready.current) releaseImages(ready.current.imgs); }, []);
  // 미리 만든 것이 없으면(방금 바뀜) 지금 만든다
  const images = async () => {
    const r = ready.current;
    if (r && r.snap === snap && r.date === date && r.title === title) return r.imgs;
    setBusy(true);
    try {
      const imgs = await makeImages(sheetRef.current!, fileName, label);
      if (ready.current) releaseImages(ready.current.imgs);
      ready.current = { snap, date, title, imgs };
      return imgs;
    } finally { setBusy(false); }
  };
  const onSave = async () => {
    try {
      saveImages(await images());
      store.toast('이미지 3장 (육지 · 제주 · 현장) 저장');
    } catch (e) { store.toast(`이미지 저장 실패: ${(e as Error).message}`, 'warn'); }
  };
  const onShare = async () => {
    try {
      const imgs = await images();
      if (!(await shareImages(imgs, label))) {
        saveImages(imgs);
        store.toast('이 기기는 바로 공유가 안 됩니다. 저장한 이미지 3장을 카카오톡에서 보내세요', 'warn');
      }
    } catch (e) { store.toast(`공유 실패: ${(e as Error).message}`, 'warn'); }
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
        <button disabled={busy} onClick={() => void onSave()}>🖼 이미지 저장</button>
        <button disabled={busy} className="kakao" onClick={() => void onShare()}>💬 카톡 공유</button>
        {wide && staff && <button onClick={() => exportSchedule(snap, date, date)}>⬇ 엑셀</button>}
      </div>
      {busy && <p className="muted small" style={{ textAlign: 'center' }}>이미지 만드는 중…</p>}
    </div>
  );
}
