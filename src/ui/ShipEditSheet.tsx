// 선박 추가·수정 (차량·설정 › 선박, 선박 고르기 목록에서 함께 사용)
import { useState } from 'react';
import { newId, type Ship } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { Sheet } from './Sheet.tsx';

/** 육지 출발 항구 바로 넣기 버튼 */
const LAND_PORTS = ['목포', '부산', '완도', '삼천포', '녹동', '여수', '진도', '인천', '고흥'];

export const blankShip = (sortOrder: number): Ship =>
  ({ id: newId(), name: '', departs_at: '', route: 'both', arrival_day_offset: 1, sort_order: sortOrder, port_times: [] });

export function ShipEditSheet({ ship, close }: { ship: Ship; close: () => void }) {
  const isNew = !store.getState().snap.ships.some((x) => x.id === ship.id);
  const [x, setX] = useState<Ship>({ ...ship, port_times: ship.port_times ?? [] });
  const set = (p: Partial<Ship>) => setX({ ...x, ...p });
  const ports = x.port_times ?? [];
  const setPort = (i: number, p: Partial<{ port: string; time: string }>) => set({ port_times: ports.map((y, j) => (j === i ? { ...y, ...p } : y)) });
  const save = () => {
    if (!x.name.trim()) return store.toast('선박명을 입력하세요', 'warn');
    const row = { ...x, name: x.name.trim(), port_times: ports.filter((p) => p.port.trim()).map((p) => ({ port: p.port.trim(), time: p.time })) };
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
        <span>출발 시간 (출발 항구별)</span>
        <div className="port-row">
          <b className="port-name">제주</b>
          <input type="time" aria-label="제주 출발 시간" value={x.departs_at} onChange={(e) => set({ departs_at: e.target.value })} />
          <span className="port-x" />
        </div>
        {ports.map((p, i) => (
          <div className="port-row" key={i}>
            <input className="port-name" placeholder="항구" aria-label="출발 항구" value={p.port} onChange={(e) => setPort(i, { port: e.target.value })} />
              <input type="time" aria-label={`${p.port || '항구'} 출발 시간`} value={p.time} onChange={(e) => setPort(i, { time: e.target.value })} />
            <button className="ghost port-x" aria-label={`${p.port || '항구'} 삭제`} onClick={() => set({ port_times: ports.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', marginTop: 6 }}>
          {LAND_PORTS.filter((n) => !ports.some((p) => p.port.trim() === n)).map((n) => (
            <button key={n} className="chip" onClick={() => set({ port_times: [...ports, { port: n, time: '' }] })}>＋ {n}</button>
          ))}
          <button className="chip" onClick={() => set({ port_times: [...ports, { port: '', time: '' }] })}>＋ 직접 입력</button>
        </div>
        <span className="muted small">육지 항구 버튼을 누르면 줄이 생깁니다. 시간을 넣으세요. 배차에서 하행 선박을 고를 때 "선박 · 목포 01:00"처럼 항구별로 나옵니다.</span>
      </div>
      <label className="field"><span>항로</span>
        <select value={x.route} onChange={(e) => set({ route: e.target.value as Ship['route'] })}>
          <option value="both">양방향</option><option value="up">제주 출발만 (제주 → 육지)</option><option value="down">육지 출발만 (육지 → 제주)</option>
        </select>
      </label>
      <label className="field"><span>도착일 차이 (상차 다음 며칠 뒤 하차, 기본 1)</span>
        <input inputMode="numeric" value={x.arrival_day_offset} onChange={(e) => set({ arrival_day_offset: Number(e.target.value) || 0 })} />
      </label>
    </Sheet>
  );
}
