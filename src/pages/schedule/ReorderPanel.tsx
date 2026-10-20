// 일정표 차량 줄 순서 바꾸기: 차량을 눌러 고른 뒤 옮길 자리의 차량을 누르면 그 위로 이동 (PC 는 끌어다 놓기도 가능)
import { useState } from 'react';
import { moveVehicle, nudgeVehicle, type BoardRow } from '../../domain/index.ts';
import { store } from '../../data/store.ts';
import { useSnap } from '../../ui/hooks.ts';
import { driverName } from '../../ui/labels.ts';

export function ReorderPanel({ rows, onDone }: { rows: BoardRow[]; onDone: () => void }) {
  const snap = useSnap();
  const [picked, setPicked] = useState<string | null>(null);
  const list = rows.filter((r) => !r.secondary);
  const ids = list.map((r) => r.vehicle.id);
  const tap = (id: string) => {
    if (!picked) return setPicked(id);
    if (picked !== id) store.run((tx) => moveVehicle(tx, picked, id));
    setPicked(null);
  };
  return (
    <div>
      <div className="banner blue">
        {picked
          ? <>옮길 자리의 차량을 누르세요 → <b>{snap.vehicles.find((v) => v.id === picked)?.short_no}</b> 이(가) 그 위로 갑니다</>
          : <>옮길 차량을 누르고, 들어갈 자리의 차량을 누르세요. ▲▼ 로 한 칸씩도 됩니다. 순서는 모든 날짜에 똑같이 적용됩니다.</>}
      </div>
      {list.map((r) => (
        <div
          key={r.vehicle.id}
          className={`reorder-item${picked === r.vehicle.id ? ' picked' : picked ? ' target' : ''}`}
          onClick={() => tap(r.vehicle.id)}
          draggable
          onDragStart={(e) => e.dataTransfer.setData('text/vehicle', r.vehicle.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('text/vehicle');
            if (id && id !== r.vehicle.id) store.run((tx) => moveVehicle(tx, id, r.vehicle.id));
          }}
        >
          <span aria-hidden>≡</span>
          <span className="no">{r.vehicle.short_no}</span>
          <span className="grow muted">{r.vehicle.vehicle_type} {driverName(snap, r.driverId)}</span>
          <button className="ghost" aria-label="위로" onClick={(e) => { e.stopPropagation(); store.run((tx) => nudgeVehicle(tx, r.vehicle.id, -1, ids)); }}>▲</button>
          <button className="ghost" aria-label="아래로" onClick={(e) => { e.stopPropagation(); store.run((tx) => nudgeVehicle(tx, r.vehicle.id, 1, ids)); }}>▼</button>
        </div>
      ))}
      {picked && <button style={{ width: '100%' }} onClick={() => { store.run((tx) => moveVehicle(tx, picked, null)); setPicked(null); }}>맨 아래로 보내기</button>}
      <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={onDone}>순서 바꾸기 끝</button>
    </div>
  );
}
