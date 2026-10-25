// 그날 근무 처리: 근무(형태 여러 개) / 휴무 / 근무일 아님. 시간외근무는 몇 시간·금액까지
import { useState } from 'react';
import { ON_CALL_SHIFT, WORK_TYPES, addDays, assignedDriverIds, dayPayOf, fixedOffDays, payRatesOf, setDayKind, setDayPay, swapDayOff, weekdayOf, workLogOf, type WorkType } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { fmtDate } from '../lib/time.ts';
import { useRole, useSnap } from './hooks.ts';
import { Sheet } from './Sheet.tsx';

type Kind = 'work' | 'off' | 'nonwork';
const HOURS = [0.5, 1, 1.5, 2, 3, 4, 5, 6];
const won = (n: number) => n.toLocaleString('ko-KR');

export function WorkTypeSheet({ date, driverId, close }: { date: string; driverId: string; close: () => void }) {
  const snap = useSnap();
  const { staff } = useRole();
  const driver = snap.drivers.find((d) => d.id === driverId);
  const log = workLogOf(snap, driverId, date);
  const isOff = snap.field_assignments.some((f) => f.date === date && f.staff_id === driverId && f.is_off);
  const [kind, setKind] = useState<Kind>(isOff ? 'off' : log?.day_status === 'nonwork' ? 'nonwork' : 'work');
  const [types, setTypes] = useState<WorkType[]>(log?.work_types ?? []);
  const offTask = snap.field_assignments.find((f) => f.date === date && f.staff_id === driverId && f.is_off)?.task;
  const [memo, setMemo] = useState(isOff ? (offTask && offTask !== '휴무' ? offTask : '') : log?.memo ?? '');
  const [hours, setHours] = useState(log?.overtime_hours == null ? '' : String(log.overtime_hours));
  const curPay = dayPayOf(snap, driverId, date)?.amount;
  const [pay, setPay] = useState(curPay == null ? '' : won(curPay));
  const hourly = payRatesOf(snap, driverId)?.rates.시간외근무;
  const hoursNum = hours === '' ? null : Number(hours);
  const toggle = (t: WorkType) => setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t]);
  const overtime = kind === 'work' && types.includes('시간외근무');
  // 매주 쉬는 날에 나와 일하면 다른 날 대신 쉴 수 있게 (대체 휴무)
  const regularOff = !!driver && fixedOffDays(driver).includes(weekdayOf(date));
  const [swap, setSwap] = useState(false);
  const [swapDate, setSwapDate] = useState(addDays(date, 1));

  const save = (k: Kind, t: WorkType[], m: string) => {
    if (k === 'off' && assignedDriverIds(snap, date).has(driverId) && !confirm(`${driver?.name ?? ''} 기사가 이날 배차되어 있습니다. 휴무로 하면 배차에서 빠집니다. 계속할까요?`)) return;
    const digits = pay.replace(/[^\d]/g, '');
    if (k === 'work' && swap && assignedDriverIds(snap, swapDate).has(driverId) && !confirm(`${driver?.name ?? ''} 기사가 ${fmtDate(swapDate)}에 배차되어 있습니다. 대체 휴무로 하면 그날 배차에서 빠집니다. 계속할까요?`)) return;
    store.run((tx) => {
      if (k === 'work' && swap) swapDayOff(tx, { driver_id: driverId, workDate: date, offDate: swapDate, work_types: t, memo: m });
      setDayKind(tx, { date, driver_id: driverId, kind: k, work_types: t, memo: m || (k === 'work' && swap ? `대체 근무 (${fmtDate(swapDate)} 휴무)` : m), overtime_hours: hoursNum != null && Number.isFinite(hoursNum) ? hoursNum : null });
      if (staff && k === 'work' && t.includes('시간외근무')) setDayPay(tx, { date, driver_id: driverId, amount: digits ? Number(digits) : null });
    });
    close();
  };
  const onCall = driver?.shift === ON_CALL_SHIFT;
  return (
    <Sheet
      title={`${driver?.name ?? ''} · ${fmtDate(date)} 근무`}
      onClose={close}
      footer={<>
        {(log || isOff) && <button onClick={() => save('work', [], '')}>{onCall ? '출근 취소' : '지우기'}</button>}
        <button className="primary" onClick={() => save(kind, types, memo)}>저장</button>
      </>}
    >
      <div className="seg" style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {([['work', '근무'], ['off', '휴무'], ['nonwork', '근무일 아님']] as [Kind, string][]).map(([k, l]) => (
          <button key={k} className={`chip ${kind === k ? 'on' : ''}`} style={{ flex: 1, minHeight: 46, fontSize: 16 }} onClick={() => setKind(k)}>{l}</button>
        ))}
      </div>
      {kind === 'off' && <p className="muted small">휴무로 저장하면 일정표 휴무 명단에 나오고, 이날 배차·기사 선택에서 빠집니다.</p>}
      {kind === 'nonwork' && <p className="muted small">근무일이 아닌 날로 표시합니다. 근무일수·수당 계산에서 빠지고, 휴무 명단에도 나오지 않습니다.</p>}
      {kind === 'work' && regularOff && (
        <div className="card" style={{ background: '#eff6ff', margin: '0 0 10px' }}>
          <div className="small"><b>{fmtDate(date)}은 {driver?.name}의 매주 쉬는 날입니다.</b></div>
          <label className="row" style={{ alignItems: 'center', gap: 8, minHeight: 44 }}>
            <input type="checkbox" checked={swap} onChange={(e) => setSwap(e.target.checked)} style={{ width: 22, height: 22 }} />
            <span style={{ fontSize: 16 }}>🔁 대신 다른 날 쉬기 (대체 휴무)</span>
          </label>
          {swap && (
            <div className="row" style={{ alignItems: 'center', gap: 6 }}>
              <span>쉬는 날</span>
              <input type="date" value={swapDate} onChange={(e) => e.target.value && setSwapDate(e.target.value)} style={{ width: 'auto' }} />
              <button className="chip" onClick={() => setSwapDate(addDays(date, 1))}>다음 날</button>
            </div>
          )}
        </div>
      )}
      {kind === 'work' && (
        <>
          {onCall && <div className="banner blue small">알바 기사입니다. 근무형태를 저장하면 이날 출근으로 잡혀 배차 목록 "오늘 근무"에 나옵니다.</div>}
          <p className="muted small">해당하는 것을 모두 고르세요 (여러 개 가능)</p>
          <div className="row wrap">
            {WORK_TYPES.map((t) => (
              <button key={t} className={`chip${types.includes(t) ? ' on' : ''}`} style={{ minHeight: 44, fontSize: 16 }} onClick={() => toggle(t)}>
                {types.includes(t) ? '✓ ' : ''}{t}
              </button>
            ))}
          </div>
          {overtime && (
            <div className="card" style={{ marginTop: 10 }}>
              <b>시간외근무</b>
              <div className="field">
                <span>추가 근무 시간</span>
                <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
                  {HOURS.map((h) => <button key={h} className={`chip ${hoursNum === h ? 'on' : ''}`} style={{ minHeight: 40 }} onClick={() => setHours(String(h))}>{h}시간</button>)}
                </div>
                <input type="number" inputMode="decimal" step="0.5" min="0" style={{ marginTop: 6 }} value={hours} placeholder="직접 입력 (시간)" onChange={(e) => setHours(e.target.value)} />
              </div>
              {staff && (
                <label className="field">
                  <span>금액 (원)</span>
                  <input inputMode="numeric" value={pay} onChange={(e) => setPay(e.target.value)}
                    placeholder={hourly != null && hoursNum ? `비우면 ${hoursNum}시간 × ${won(hourly)}원 = ${won(Math.round(hoursNum * hourly))}원` : '예: 30,000'} />
                  <small className="muted">{hourly != null ? `시간당 수당 ${won(hourly)}원 (기사 정보 · 근무별 수당). 금액을 적으면 그 금액으로 계산합니다.` : '시간당 수당이 없으면 여기 적은 금액으로 계산합니다.'}</small>
                </label>
              )}
            </div>
          )}
        </>
      )}
      <label className="field"><span>{kind === 'off' ? '휴무 사유 (일정표에는 안 나옴)' : '메모'}</span><input value={memo} placeholder={kind === 'off' ? '예: 연차, 병가' : '예: 02시 출근, 서귀포 2회전'} onChange={(e) => setMemo(e.target.value)} /></label>
    </Sheet>
  );
}
