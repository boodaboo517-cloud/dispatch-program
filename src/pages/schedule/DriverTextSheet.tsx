// 기사별 일정 문자: 사람 고르기 → 문자 미리보기(고칠 수 있음) → 카톡 공유 / 복사
import { useState } from 'react';
import type { Board } from '../../domain/index.ts';
import { store } from '../../data/store.ts';
import { fmtDate } from '../../lib/time.ts';
import { useSnap } from '../../ui/hooks.ts';
import { Sheet, useSheet } from '../../ui/Sheet.tsx';
import { driverDayText, peopleOn, type PersonGroup } from './driverText.ts';

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    store.toast('복사했습니다. 카카오톡 대화창에 붙여넣기 하세요');
  } catch {
    store.toast('복사가 안 됩니다. 글을 길게 눌러 직접 복사하세요', 'warn');
  }
}

/** 휴대폰: 공유 창 → 카카오톡. 공유가 안 되는 기기(컴퓨터)는 복사 */
async function share(text: string) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  await copy(text);
}

function TextSheet({ initial, title, close }: { initial: string; title: string; close: () => void }) {
  const [text, setText] = useState(initial);
  return (
    <Sheet title={title} onClose={close} footer={<>
      <button onClick={() => void copy(text)}>📋 복사</button>
      <button className="primary kakao-btn" onClick={() => void share(text)}>💬 카톡 공유</button>
    </>}>
      <textarea className="driver-text" value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(24, text.split('\n').length + 1)} />
      <p className="muted small">보내기 전에 글을 고칠 수 있습니다 (앱 일정은 바뀌지 않음).</p>
    </Sheet>
  );
}

type Tab = '육지' | '제주' | '현장';
const TABS: Tab[] = ['육지', '제주', '현장'];

/** 사람 고르기: 육지 · 제주 · 현장 화면으로 나누고, 미분류(휴무자)는 현장 목록 밑에 */
function PeopleSheet({ board, date, close, onPick }: { board: Board; date: string; close: () => void; onPick: (id: string, name: string) => void }) {
  const snap = useSnap();
  const people = peopleOn(snap, board);
  const of = (g: PersonGroup) => people.filter((p) => p.group === g);
  const count = (t: Tab) => of(t).length + (t === '현장' ? of('휴무').length : 0);
  const [tab, setTab] = useState<Tab>(TABS.find((t) => count(t) > 0) ?? '육지');
  const item = (p: (typeof people)[number]) => (
    <div key={p.id} className="list-item" onClick={() => { close(); onPick(p.id, p.name); }}>
      <div className="grow"><div style={{ fontWeight: 700, fontSize: 17 }}>{p.name}</div><div className="muted small">{p.what}</div></div>
      <span className="muted">›</span>
    </div>
  );
  return (
    <Sheet title={`${fmtDate(date)} 기사별 일정 문자`} onClose={close}>
      <div className="tabs">
        {TABS.map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t} {count(t)}</button>)}
      </div>
      {of(tab).map(item)}
      {!of(tab).length && <p className="muted">{tab === '현장' ? '현장 근무자가 없습니다.' : `${tab} 배차 기사가 없습니다.`}</p>}
      {tab === '현장' && of('휴무').length > 0 && (
        <>
          <div className="section-label">미분류 · 휴무자 {of('휴무').length}</div>
          {of('휴무').map(item)}
        </>
      )}
    </Sheet>
  );
}

export function DriverTextButton({ board, date }: { board: Board; date: string }) {
  const sheet = useSheet();
  const openPerson = (id: string, name: string) => sheet.open((c) => (
    <TextSheet initial={driverDayText(store.getState().snap, board, date, id)} title={`${name} · ${fmtDate(date)} 일정 문자`} close={c} />
  ));
  const openList = () => sheet.open((close) => <PeopleSheet board={board} date={date} close={close} onPick={openPerson} />);
  return <button className="driver-text-btn" onClick={openList}>📝 기사별 일정 문자 (카톡)</button>;
}
