// 선박 추가·수정 (차량·설정 › 선박, 선박 고르기 목록에서 함께 사용)
import { useState } from 'react';
import { newId, type Ship } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { Sheet } from './Sheet.tsx';
import { useRole } from './hooks.ts';
import { ShipFaresCard } from './ShipFares.tsx';

/** 육지 출발 항구 바로 넣기 버튼 */
const LAND_PORTS = ['목포', '부산', '완도', '삼천포', '녹동', '여수', '진도', '인천', '고흥'];
/** 제주 쪽 출발 항구 */
const JEJU_PORTS = ['제주', '서귀포', '애월', '한림', '성산'];

/** 당일 / 익일 (출발 시간이 다음 날 새벽 등) */
function DayToggle({ next, onChange, label }: { next: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <div className="seg day-toggle" role="group" aria-label={`${label} 출발일`}>
      <button type="button" className={!next ? 'on' : ''} onClick={() => onChange(false)}>당일</button>
      <button type="button" className={next ? 'on' : ''} onClick={() => onChange(true)}>익일</button>
    </div>
  );
}

export const blankShip = (sortOrder: number): Ship =>
  ({ id: newId(), name: '', departs_at: '', route: 'both', arrival_day_offset: 1, sort_order: sortOrder, port_times: [] });

export function ShipEditSheet({ ship, close }: { ship: Ship; close: () => void }) {
  const isNew = !store.getState().snap.ships.some((x) => x.id === ship.id);
  const { staff } = useRole();
  const [x, setX] = useState<Ship>({ ...ship, port_times: ship.port_times ?? [] });
  const set = (p: Partial<Ship>) => setX({ ...x, ...p });
  const ports = x.port_times ?? [];
  const setPort = (i: number, p: Partial<{ port: string; time: string; next_day: boolean }>) => set({ port_times: ports.map((y, j) => (j === i ? { ...y, ...p } : y)) });
  const save = () => {
    if (!x.name.trim()) return store.toast('선박명을 입력하세요', 'warn');
    const row: Ship = { ...x, name: x.name.trim(), port_times: ports.filter((p) => p.port.trim()).map((p) => ({ port: p.port.trim(), time: p.time, ...(p.next_day ? { next_day: true } : {}) })) };
    // 출발 항구·익일은 쓴 때만 저장 (서버에 칸이 아직 없어도 다른 선박 저장이 실패하지 않게)
    const port = x.depart_port?.trim() ?? '';
    if (port && port !== '제주') row.depart_port = port;
    else if (ship.depart_port !== undefined) row.depart_port = '';
    else delete row.depart_port;
    if (!x.depart_next_day && ship.depart_next_day === undefined) delete row.depart_next_day;
    if (!x.wait && ship.wait === undefined) delete row.wait;
    if (!isNew) store.expectOnly(ship);
    store.run((tx) => (isNew ? tx.insert('ships', row) : tx.update('ships', row.id, row)));
    close();
  };
  return (
    <Sheet title={isNew ? '선박 추가' : `선박 수정 · ${ship.name}`} onClose={close} footer={<>
      {!isNew && <button className="danger" onClick={() => { if (confirm(`${ship.name} 선박을 삭제할까요? (이미 입력된 일정표의 선박 이름은 그대로 남습니다)`)) { store.run((tx) => tx.remove('ships', ship.id)); close(); } }}>삭제</button>}
      <button className="primary" onClick={save}>저장</button>
    </>}>
      <label className="field"><span>선박명</span><input value={x.name} onChange={(e) => set({ name: e.target.value })} /></label>
      <div className="field">
        <span>출발 지역 · 시간 (당일/익일)</span>
        <div className="port-row">
          <input className="port-name" list="jeju-ports" aria-label="제주 쪽 출발 항구" value={x.depart_port ?? ''} placeholder="제주" onChange={(e) => set({ depart_port: e.target.value })} />
          <input type="time" aria-label="제주 쪽 출발 시간" value={x.departs_at} onChange={(e) => set({ departs_at: e.target.value })} />
          <DayToggle label="제주 쪽" next={!!x.depart_next_day} onChange={(v) => set({ depart_next_day: v })} />
          <span className="port-x" />
        </div>
        <datalist id="jeju-ports">{JEJU_PORTS.map((n) => <option key={n} value={n} />)}</datalist>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', margin: '2px 0 6px' }}>
          {JEJU_PORTS.map((n) => <button key={n} type="button" className={`chip ${(x.depart_port?.trim() || '제주') === n ? 'on' : ''}`} onClick={() => set({ depart_port: n === '제주' ? '' : n })}>{n}</button>)}
        </div>
        {ports.map((p, i) => (
          <div className="port-row" key={i}>
            <input className="port-name" placeholder="항구" aria-label="출발 항구" value={p.port} onChange={(e) => setPort(i, { port: e.target.value })} />
            <input type="time" aria-label={`${p.port || '항구'} 출발 시간`} value={p.time} onChange={(e) => setPort(i, { time: e.target.value })} />
            <DayToggle label={p.port || '항구'} next={!!p.next_day} onChange={(v) => setPort(i, { next_day: v })} />
            <button className="ghost port-x" aria-label={`${p.port || '항구'} 삭제`} onClick={() => set({ port_times: ports.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', marginTop: 6 }}>
          {LAND_PORTS.filter((n) => !ports.some((p) => p.port.trim() === n)).map((n) => (
            <button key={n} className="chip" onClick={() => set({ port_times: [...ports, { port: n, time: '' }] })}>＋ {n}</button>
          ))}
          <button className="chip" onClick={() => set({ port_times: [...ports, { port: '', time: '' }] })}>＋ 직접 입력</button>
        </div>
        <span className="muted small">첫 줄은 제주 쪽 출발(항구를 고르거나 직접 입력), 아래는 육지 항구 버튼을 눌러 추가합니다. 자정이 지나 다음 날 출발하면 <b>익일</b>을 고르세요. 배차·일정표에 "익일 01:00"처럼 나옵니다.</span>
      </div>
      <div className="field">
        <span>운송 방식</span>
        <div className="seg" style={{ display: 'flex', gap: 6 }}>
          <button className={`chip ${!x.bulk && !x.wait ? 'on' : ''}`} style={{ flex: 1, minHeight: 44 }} onClick={() => set({ bulk: false, wait: false })}>🚚 차량 선적</button>
          <button className={`chip ${x.bulk ? 'on' : ''}`} style={{ flex: 1, minHeight: 44 }} onClick={() => set({ bulk: true, wait: false })}>📦 벌크</button>
          <button className={`chip ${x.wait ? 'on' : ''}`} style={{ flex: 1, minHeight: 44 }} onClick={() => set({ wait: true, bulk: false })}>⏸ 대기</button>
        </div>
        <span className="muted small">{x.wait
          ? '아직 배를 안 탄 상태(선박 미정)입니다. 차량과 짐은 그 지역에 그대로 있고, 다음 날 같은 차량에 [[ 상차짐 ]]으로 이어지며 기사는 비어 있습니다(미배치). 선박을 정하면 그날 선적됩니다.'
          : x.bulk ? '이 배로 상차하면 차량은 안 타고 화물만 갑니다. 도착지 하차는 차량번호 없이 배차 대기(미배차)로 들어갑니다.'
          : '차량이 화물을 싣고 배를 탑니다. 도착지 하차에 같은 차량이 들어갑니다.'}</span>
      </div>
      <label className="field"><span>항로</span>
        <select value={x.route} onChange={(e) => set({ route: e.target.value as Ship['route'] })}>
          <option value="both">양방향</option><option value="up">제주 출발만 (제주 → 육지)</option><option value="down">육지 출발만 (육지 → 제주)</option>
        </select>
      </label>
      <label className="field"><span>도착일 차이 (상차 다음 며칠 뒤 하차, 기본 1)</span>
        <input inputMode="numeric" value={x.arrival_day_offset} onChange={(e) => set({ arrival_day_offset: Number(e.target.value) || 0 })} />
      </label>
      {staff && (isNew ? <p className="muted small">선박을 저장한 뒤 다시 열면 요금(기본·공차·할증·승선)을 넣을 수 있습니다.</p> : <ShipFaresCard shipId={ship.id} />)}
    </Sheet>
  );
}
