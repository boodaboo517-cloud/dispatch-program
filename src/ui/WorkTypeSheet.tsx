// 기사 근무형태 선택 (여러 개 가능): 주간근무, 야간근무, 특근, 출장, 장거리, 단거리, 야간단거리, 시간외근무
import { useState } from 'react';
import { ON_CALL_SHIFT, WORK_TYPES, setWorkLog, workLogOf, type WorkType } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { fmtDate } from '../lib/time.ts';
import { useSnap } from './hooks.ts';
import { Sheet } from './Sheet.tsx';

export function WorkTypeSheet({ date, driverId, close }: { date: string; driverId: string; close: () => void }) {
  const snap = useSnap();
  const driver = snap.drivers.find((d) => d.id === driverId);
  const log = workLogOf(snap, driverId, date);
  const [types, setTypes] = useState<WorkType[]>(log?.work_types ?? []);
  const [memo, setMemo] = useState(log?.memo ?? '');
  const toggle = (t: WorkType) => setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t]);
  const save = (t: WorkType[], m: string) => {
    store.run((tx) => setWorkLog(tx, { date, driver_id: driverId, work_types: t, memo: m }));
    close();
  };
  const onCall = driver?.shift === ON_CALL_SHIFT;
  return (
    <Sheet
      title={`${driver?.name ?? ''} · ${fmtDate(date)} 근무형태`}
      onClose={close}
      footer={<>
        {log && <button onClick={() => save([], '')}>{onCall ? '출근 취소' : '지우기'}</button>}
        <button className="primary" onClick={() => save(types, memo)}>저장</button>
      </>}
    >
      {onCall && <div className="banner blue small">알바 기사입니다. 근무형태를 저장하면 이날 출근으로 잡혀 배차 목록 "오늘 근무"에 나옵니다.</div>}
      <p className="muted small">해당하는 것을 모두 고르세요 (여러 개 가능)</p>
      <div className="row wrap">
        {WORK_TYPES.map((t) => (
          <button key={t} className={`chip${types.includes(t) ? ' on' : ''}`} style={{ minHeight: 44, fontSize: 16 }} onClick={() => toggle(t)}>
            {types.includes(t) ? '✓ ' : ''}{t}
          </button>
        ))}
      </div>
      <label className="field"><span>메모</span><input value={memo} placeholder="예: 02시 출근, 서귀포 2회전" onChange={(e) => setMemo(e.target.value)} /></label>
    </Sheet>
  );
}
