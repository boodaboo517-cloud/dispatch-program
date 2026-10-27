// 기사별 일정 문자: 사람 고르기 → 문자 미리보기(고칠 수 있음) → 카톡 공유 / 복사
import { useState } from 'react';
import type { Board } from '../../domain/index.ts';
import { store } from '../../data/store.ts';
import { fmtDate } from '../../lib/time.ts';
import { useSnap } from '../../ui/hooks.ts';
import { Sheet, useSheet } from '../../ui/Sheet.tsx';
import { PERSON_GROUPS, driverDayText, peopleOn } from './driverText.ts';

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

export function DriverTextButton({ board, date }: { board: Board; date: string }) {
  const snap = useSnap();
  const sheet = useSheet();
  const openPerson = (id: string, name: string) => sheet.open((c) => (
    <TextSheet initial={driverDayText(store.getState().snap, board, date, id)} title={`${name} · ${fmtDate(date)} 일정 문자`} close={c} />
  ));
  const openList = () => sheet.open((close) => {
    const people = peopleOn(snap, board);
    return (
      <Sheet title={`${fmtDate(date)} 기사별 일정 문자`} onClose={close}>
        {!people.length && <p className="muted">이날 배차·휴무인 사람이 없습니다.</p>}
        {PERSON_GROUPS.map((g) => {
          const list = people.filter((p) => p.group === g);
          return list.length ? (
            <div key={g}>
              <div className="section-label">{g === '현장' ? '현장 근무자' : g === '휴무' ? '휴무자' : `${g} 기사`} {list.length}</div>
              {list.map((p) => (
                <div key={p.id} className="list-item" onClick={() => { close(); openPerson(p.id, p.name); }}>
                  <div className="grow"><div style={{ fontWeight: 700, fontSize: 17 }}>{p.name}</div><div className="muted small">{p.what}</div></div>
                  <span className="muted">›</span>
                </div>
              ))}
            </div>
          ) : null;
        })}
      </Sheet>
    );
  });
  return <button className="driver-text-btn" onClick={openList}>📝 기사별 일정 문자 (카톡)</button>;
}
