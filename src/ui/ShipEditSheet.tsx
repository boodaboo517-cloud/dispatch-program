// 선박 추가·수정 (차량·설정 › 선박, 선박 고르기 목록에서 함께 사용)
import { useState } from 'react';
import { newId, type Ship } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { Sheet } from './Sheet.tsx';

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
      <label className="field"><span>제주 출발 (상행) 시간</span><input type="time" value={x.departs_at} onChange={(e) => set({ departs_at: e.target.value })} /></label>
      <div className="field">
        <span className="muted small">기항지별 하행 (육지 → 제주) 출발 시간</span>
        {ports.map((p, i) => (
          <div className="row" key={i} style={{ margin: '6px 0' }}>
            <input placeholder="기항지 (예: 목포)" value={p.port} onChange={(e) => setPort(i, { port: e.target.value })} />
            <input type="time" style={{ width: 130 }} value={p.time} onChange={(e) => setPort(i, { time: e.target.value })} />
            <button className="ghost" aria-label="기항지 삭제" onClick={() => set({ port_times: ports.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button onClick={() => set({ port_times: [...ports, { port: '', time: '' }] })}>＋ 기항지 추가</button>
      </div>
      <label className="field"><span>항로</span>
        <select value={x.route} onChange={(e) => set({ route: e.target.value as Ship['route'] })}>
          <option value="both">양방향</option><option value="up">상행만 (제주 → 육지)</option><option value="down">하행만 (육지 → 제주)</option>
        </select>
      </label>
      <label className="field"><span>도착일 차이 (상차 다음 며칠 뒤 하차, 기본 1)</span>
        <input inputMode="numeric" value={x.arrival_day_offset} onChange={(e) => set({ arrival_day_offset: Number(e.target.value) || 0 })} />
      </label>
      <p className="muted small">기항지를 넣으면 육지 하행선박을 고를 때 "퀸메리 · 목포 01:00"처럼 기항지별로 나옵니다. 기항지가 없으면 선박명 하나로 나옵니다.</p>
    </Sheet>
  );
}
