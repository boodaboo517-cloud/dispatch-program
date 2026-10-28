// 기사별 일정 문자: 사람 고르기 → 문자 미리보기(고칠 수 있음) → 카톡 공유 / 복사.
// 카톡은 앱이 정한 대화방으로 바로 보내는 것을 허용하지 않으므로, 사람마다 보낼 카톡방 이름을 이 기기에 기억해 두고
// "모두 차례로 보내기"로 한 사람씩 공유 창을 띄운다 (카톡에서 그 방만 고르면 됨).
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

/** 휴대폰: 공유 창 → 카카오톡. 공유가 안 되는 기기(컴퓨터)는 복사. 보냈으면(창을 닫지 않았으면) true */
async function share(text: string): Promise<boolean> {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
    }
  }
  await copy(text);
  return true;
}

/** 사람별 카톡방 이름 (이 기기에만 저장: 카톡방은 보내는 사람 휴대폰에 있으므로) */
const ROOM_KEY = 'kakao-rooms';
function loadRooms(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(ROOM_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}
function saveRoom(id: string, room: string) {
  try {
    const all = loadRooms();
    if (room.trim()) all[id] = room.trim();
    else delete all[id];
    localStorage.setItem(ROOM_KEY, JSON.stringify(all));
  } catch {
    // 저장 공간 문제는 무시 (방 이름만 기억 못 함)
  }
}

function RoomField({ id, name, room, setRoom }: { id: string; name: string; room: string; setRoom: (v: string) => void }) {
  return (
    <label className="field room-field">
      <span>보낼 카톡방</span>
      <input value={room} placeholder={`예: ${name} 기사님, 제주 기사방`} onChange={(e) => setRoom(e.target.value)} onBlur={() => saveRoom(id, room)} />
    </label>
  );
}

function TextSheet({ id, name, initial, title, close }: { id: string; name: string; initial: string; title: string; close: () => void }) {
  const [text, setText] = useState(initial);
  const [room, setRoom] = useState(loadRooms()[id] ?? '');
  return (
    <Sheet title={title} onClose={close} footer={<>
      <button onClick={() => void copy(text)}>📋 복사</button>
      <button className="primary kakao-btn" onClick={() => { saveRoom(id, room); void share(text); }}>💬 {room ? `${room}에 보내기` : '카톡 공유'}</button>
    </>}>
      <RoomField id={id} name={name} room={room} setRoom={setRoom} />
      <textarea className="driver-text" value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(24, text.split('\n').length + 1)} />
      <p className="muted small">보내기 전에 글을 고칠 수 있습니다 (앱 일정은 바뀌지 않음).</p>
    </Sheet>
  );
}

type Person = ReturnType<typeof peopleOn>[number];

/** 모두 차례로 보내기: 한 사람씩 문자 · 카톡방을 보여 주고, 보내면 다음 사람으로 */
function QueueSheet({ people, board, date, close }: { people: Person[]; board: Board; date: string; close: () => void }) {
  const [i, setI] = useState(0);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const p = people[i];
  const textOf = (x: Person) => driverDayText(store.getState().snap, board, date, x.id);
  const [text, setText] = useState(() => (p ? textOf(p) : ''));
  const [room, setRoom] = useState(() => (p ? loadRooms()[p.id] ?? '' : ''));
  const go = (n: number) => {
    const next = people[n];
    setI(n);
    if (next) { setText(textOf(next)); setRoom(loadRooms()[next.id] ?? ''); }
  };
  if (!p) {
    return (
      <Sheet title="모두 보내기 끝" onClose={close} footer={<button className="primary" onClick={close}>닫기</button>}>
        <p><b>{sent.size}명</b> 보냄{people.length - sent.size ? ` · ${people.length - sent.size}명 건너뜀` : ''}</p>
        {people.filter((x) => !sent.has(x.id)).map((x) => <div key={x.id} className="muted">건너뜀: {x.name}</div>)}
      </Sheet>
    );
  }
  const send = async () => {
    saveRoom(p.id, room);
    if (await share(text)) {
      setSent(new Set(sent).add(p.id));
      go(i + 1);
    }
  };
  return (
    <Sheet title={`${i + 1}/${people.length} · ${p.name}`} onClose={close} footer={<>
      <button onClick={() => go(i + 1)}>건너뛰기</button>
      <button className="primary kakao-btn" onClick={() => void send()}>💬 {room ? `${room}에 보내기` : '카톡 공유'}</button>
    </>}>
      <div className="queue-bar"><div style={{ width: `${(i / people.length) * 100}%` }} /></div>
      <RoomField id={p.id} name={p.name} room={room} setRoom={setRoom} />
      <textarea className="driver-text" value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(18, text.split('\n').length + 1)} />
      <p className="muted small">보내기를 누르면 카톡이 열립니다. <b>{room || '보낼 방'}</b>을 고르고 보내면 다음 사람으로 넘어갑니다.</p>
      {i > 0 && <button className="ghost" onClick={() => go(i - 1)}>◀ 이전 사람</button>}
    </Sheet>
  );
}

type Tab = '육지' | '제주' | '현장';
const TABS: Tab[] = ['육지', '제주', '현장'];

/** 사람 고르기: 육지 · 제주 · 현장 화면으로 나누고, 미분류(휴무자)는 현장 목록 밑에 */
function PeopleSheet({ board, date, close, onPick, onQueue }: {
  board: Board; date: string; close: () => void; onPick: (p: Person) => void; onQueue: (people: Person[]) => void;
}) {
  const snap = useSnap();
  const people = peopleOn(snap, board);
  const of = (g: PersonGroup) => people.filter((p) => p.group === g);
  const inTab = (t: Tab) => [...of(t), ...(t === '현장' ? of('휴무') : [])];
  const [tab, setTab] = useState<Tab>(TABS.find((t) => inTab(t).length > 0) ?? '육지');
  const rooms = loadRooms();
  const item = (p: Person) => (
    <div key={p.id} className="list-item" onClick={() => { close(); onPick(p); }}>
      <div className="grow">
        <div style={{ fontWeight: 700, fontSize: 17 }}>{p.name}</div>
        <div className="muted small">{p.what}{rooms[p.id] ? ` · 💬 ${rooms[p.id]}` : ''}</div>
      </div>
      <span className="muted">›</span>
    </div>
  );
  return (
    <Sheet title={`${fmtDate(date)} 기사별 일정 문자`} onClose={close}>
      <div className="tabs">
        {TABS.map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t} {inTab(t).length}</button>)}
      </div>
      {inTab(tab).length > 0 && (
        <button className="primary kakao-btn queue-btn" onClick={() => { close(); onQueue(inTab(tab)); }}>📤 {tab} {inTab(tab).length}명 모두 차례로 보내기</button>
      )}
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
  const openPerson = (p: Person) => sheet.open((c) => (
    <TextSheet id={p.id} name={p.name} initial={driverDayText(store.getState().snap, board, date, p.id)} title={`${p.name} · ${fmtDate(date)} 일정 문자`} close={c} />
  ));
  const openQueue = (people: Person[]) => sheet.open((c) => <QueueSheet people={people} board={board} date={date} close={c} />);
  const openList = () => sheet.open((close) => <PeopleSheet board={board} date={date} close={close} onPick={openPerson} onQueue={openQueue} />);
  return <button className="driver-text-btn" onClick={openList}>📝 기사별 일정 문자 (카톡)</button>;
}
