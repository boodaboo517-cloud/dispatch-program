// 월별 일정: 날짜별 상차/하차 건수, 미래는 반복 자동 건수 · 미배차 건수, 정비 예정
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, buildIndex, nextDue, recurringCountOn, weekdayOf } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { dayjs, seoulToday } from '../lib/time.ts';
import { useSnap } from '../ui/hooks.ts';
import { vehicleNo } from '../ui/labels.ts';

export function MonthlyPage() {
  const snap = useSnap();
  const nav = useNavigate();
  const today = seoulToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const first = `${month}-01`;
  const start = addDays(first, -weekdayOf(first));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  useEffect(() => {
    void store.ensureFrom(start);
  }, [start]);

  const idx = useMemo(() => buildIndex(snap), [snap]);
  const dueByDate = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of snap.maintenance_schedules) {
      const d = nextDue(snap, s, today);
      if (d.dueDate) m.set(d.dueDate, [...(m.get(d.dueDate) ?? []), `${vehicleNo(snap, s.vehicle_id)} ${s.kind}`]);
    }
    for (const r of snap.maintenance_records) {
      m.set(r.start_date, [...(m.get(r.start_date) ?? []), `${vehicleNo(snap, r.vehicle_id)} ${r.kind}`]);
    }
    return m;
  }, [snap, today]);

  const move = (n: number) => setMonth(dayjs(first).add(n, 'month').format('YYYY-MM'));
  return (
    <div className="page">
      <div className="datebar">
        <button onClick={() => move(-1)}>◀</button>
        <div className="date">{dayjs(first).format('YYYY년 M월')}</div>
        <button onClick={() => move(1)}>▶</button>
      </div>
      <div className="cal">
        {['일', '월', '화', '수', '목', '금', '토'].map((d) => <div key={d} className="dh">{d}</div>)}
        {days.map((d) => {
          const orders = idx.ordersByDate.get(d) ?? [];
          const unloads = orders.filter((o) => o.kind === 'unload').length;
          const loads = orders.filter((o) => o.kind === 'load').length;
          const waiting = orders.filter((o) => !o.vehicle_id).length;
          const future = d > today;
          const rec = future ? recurringCountOn(snap, d) : 0;
          const dues = dueByDate.get(d) ?? [];
          return (
            <div key={d} className={`day${d === today ? ' today' : ''}${d.slice(0, 7) !== month ? ' other' : ''}`} onClick={() => nav(`/?date=${d}`)}>
              <div className="n" style={{ color: weekdayOf(d) === 0 ? 'var(--red)' : weekdayOf(d) === 6 ? 'var(--blue)' : undefined }}>{Number(d.slice(8))}</div>
              {unloads > 0 && <div className="ln">하 {unloads}</div>}
              {loads > 0 && <div className="ln">상 {loads}</div>}
              {future && rec > 0 && <div className="ln muted">🔁 {rec}</div>}
              {waiting > 0 && <div className="ln" style={{ background: 'var(--yellow)', borderRadius: 3 }}>미배차 {waiting}</div>}
              {dues.length > 0 && <div className="ln" style={{ color: 'var(--red)' }} title={dues.join(', ')}>🔧 {dues.length}</div>}
            </div>
          );
        })}
      </div>
      <p className="muted small">하=하차(제주 오전) · 상=상차(제주 오후) · 🔁 반복 발주 자동 건수 · 🔧 정비·검사 예정</p>
    </div>
  );
}
