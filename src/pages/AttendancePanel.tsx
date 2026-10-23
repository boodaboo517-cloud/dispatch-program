// 기사·직원 근무현황: 가로 = 이름, 세로 = 날짜. 월·주·기간, 인원 골라 보기, 칸을 누르면 근무형태 입력, 근무별 수당 합계
import { useMemo, useState } from 'react';
import {
  ON_CALL_SHIFT, WORK_TYPES, addDays, driverGroup, WORK_TYPE_SHORT, monthlyDriverStatus, paySummary, weekdayOf, type DayCell, type Driver, type DriverMonth, type Snapshot,
} from '../domain/index.ts';
import { boxBorder, download, fill, header, newWorkbook } from '../excel/common.ts';
import { dayjs, seoulToday } from '../lib/time.ts';
import { useRole, useSnap } from '../ui/hooks.ts';
import { PayRatesCard } from '../ui/PayRates.tsx';
import { usePickers } from '../ui/pickers.tsx';
import { Sheet, useSheet } from '../ui/Sheet.tsx';

type Mode = 'month' | 'week' | 'range';
type StaffType = Driver['staff_type'] | 'all';
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const PEOPLE_KEY = 'attendance_people';
const won = (n: number) => n.toLocaleString('ko-KR');

function cellText(c: DayCell) {
  if (c.off) return '휴';
  if (c.types.length) return c.types.map((t) => WORK_TYPE_SHORT[t]).join('');
  if (c.field) return '현';
  if (c.assigned) return '배';
  return '';
}

const dayLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))} ${WD[weekdayOf(d)]}`;

/** 월요일 시작 주 */
function weekStart(d: string) {
  const wd = weekdayOf(d);
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}

function periodOf(mode: Mode, anchor: string, range: { from: string; to: string }) {
  if (mode === 'month') {
    const from = `${anchor.slice(0, 7)}-01`;
    return { from, to: dayjs(from).endOf('month').format('YYYY-MM-DD'), title: dayjs(from).format('YYYY년 M월') };
  }
  if (mode === 'week') {
    const from = weekStart(anchor);
    const to = addDays(from, 6);
    return { from, to, title: `${dayLabel(from)} ~ ${dayLabel(to)}` };
  }
  const [from, to] = range.from <= range.to ? [range.from, range.to] : [range.to, range.from];
  return { from, to, title: `${dayLabel(from)} ~ ${dayLabel(to)}` };
}

function loadPeople(): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(PEOPLE_KEY) ?? 'null');
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}
function savePeople(ids: string[] | null) {
  try { ids ? localStorage.setItem(PEOPLE_KEY, JSON.stringify(ids)) : localStorage.removeItem(PEOPLE_KEY); } catch { /* 저장 안 돼도 화면은 동작 */ }
}

async function exportAttendance(snap: Snapshot, title: string, rows: DriverMonth[], withPay: boolean) {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('근무현황');
  const days = rows[0]?.days ?? [];
  const cols = rows.length + 1;
  ws.mergeCells(1, 1, 1, Math.max(cols, 2));
  ws.getCell(1, 1).value = `경민물류 근무현황 ${title}`;
  ws.getCell(1, 1).font = { bold: true, size: 16 };
  header(ws, 3, ['날짜', ...rows.map((r) => r.driver.name)]);
  ws.getColumn(1).width = 11;
  rows.forEach((_, i) => (ws.getColumn(2 + i).width = 9));
  days.forEach((d, j) => {
    const line = 4 + j;
    ws.getCell(line, 1).value = dayLabel(d.date);
    rows.forEach((r, i) => {
      const c = r.days[j];
      const cell = ws.getCell(line, 2 + i);
      cell.value = cellText(c);
      cell.alignment = { horizontal: 'center' };
      if (c.memo) cell.note = c.memo;
      if (!c.scheduled && !cellText(c)) fill(cell, 'FFF3F4F6');
      if (c.assigned && !c.types.length) fill(cell, 'FFFEF9C3');
    });
  });
  let line = 4 + days.length;
  const sumRow = (label: string, val: (r: DriverMonth) => number | string) => {
    ws.getCell(line, 1).value = label;
    ws.getCell(line, 1).font = { bold: true };
    rows.forEach((r, i) => (ws.getCell(line, 2 + i).value = val(r) || ''));
    line++;
  };
  sumRow('근무일', (r) => r.workedDays);
  for (const t of WORK_TYPES) sumRow(t, (r) => r.byType[t]);
  sumRow('형태 미입력', (r) => r.missingType);
  if (withPay) {
    for (const t of WORK_TYPES) sumRow(`${t} 수당`, (r) => paySummary(snap, r).byType[t] ?? 0);
    sumRow('수당 합계', (r) => paySummary(snap, r).total);
  }
  boxBorder(ws, 3, 1, line - 1, cols, { style: 'thin', color: { argb: 'FF9CA3AF' } } as never);
  ws.getCell(line + 1, 1).value = `약자: ${WORK_TYPES.map((t) => `${WORK_TYPE_SHORT[t]}=${t}`).join(', ')}, 배=배차(형태 미입력), 현=현장근무(형태 미입력), 휴=휴무`;
  await download(wb, `근무현황 ${title.replace(/[/~ ]+/g, '_')}.xlsx`);
}

function PeopleSheet({ all, picked, close, onSave }: { all: Driver[]; picked: string[] | null; close: () => void; onSave: (ids: string[] | null) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set(picked ?? all.map((d) => d.id)));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const groups = new Map<string, Driver[]>();
  for (const d of all) (groups.get(driverGroup(d)) ?? groups.set(driverGroup(d), []).get(driverGroup(d))!).push(d);
  return (
    <Sheet title="볼 인원 선택" onClose={close} footer={<>
      <button onClick={() => { onSave(null); close(); }}>전체 보기</button>
      <button className="primary" onClick={() => { onSave(sel.size === all.length ? null : [...sel]); close(); }}>{sel.size}명 보기</button>
    </>}>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <button className="chip" onClick={() => setSel(new Set(all.map((d) => d.id)))}>모두 선택</button>
        <button className="chip" onClick={() => setSel(new Set())}>모두 해제</button>
      </div>
      {[...groups].map(([g, list]) => (
        <div key={g} style={{ marginBottom: 10 }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <b className="grow">{g}</b>
            <button className="chip" onClick={() => setSel((s) => { const n = new Set(s); const allOn = list.every((d) => n.has(d.id)); for (const d of list) if (allOn) n.delete(d.id); else n.add(d.id); return n; })}>묶음 선택</button>
          </div>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {list.map((d) => <button key={d.id} className={`chip ${sel.has(d.id) ? 'on' : ''}`} style={{ minHeight: 40 }} onClick={() => toggle(d.id)}>{d.name}</button>)}
          </div>
        </div>
      ))}
    </Sheet>
  );
}

export function AttendancePanel() {
  const snap = useSnap();
  const pick = usePickers();
  const sheet = useSheet();
  const { staff } = useRole();
  const today = seoulToday();
  const [mode, setMode] = useState<Mode>('month');
  const [anchor, setAnchor] = useState(today);
  const [range, setRange] = useState({ from: addDays(today, -13), to: today });
  const [type, setType] = useState<StaffType>('기사');
  const [picked, setPicked] = useState<string[] | null>(loadPeople);
  const { from, to, title } = periodOf(mode, anchor, range);

  const pool = useMemo(
    () => snap.drivers.filter((d) => type === 'all' || d.staff_type === type)
      .sort((a, b) => driverGroup(a).localeCompare(driverGroup(b), 'ko', { numeric: true }) || a.name.localeCompare(b.name, 'ko')),
    [snap.drivers, type],
  );
  const drivers = useMemo(() => {
    const set = picked && new Set(picked);
    const list = set ? pool.filter((d) => set.has(d.id)) : pool;
    return list.length ? list : pool;
  }, [pool, picked]);
  const rows = useMemo(() => monthlyDriverStatus(snap, from, to, drivers), [snap, from, to, drivers]);
  const pays = useMemo(() => (staff ? rows.map((r) => paySummary(snap, r)) : []), [snap, rows, staff]);
  const days = rows[0]?.days.map((c) => c.date) ?? [];
  const narrowed = picked && drivers.length < pool.length;

  const move = (n: number) => setAnchor(mode === 'month' ? dayjs(anchor).add(n, 'month').format('YYYY-MM-DD') : addDays(anchor, 7 * n));
  const pickPeople = () => sheet.open((close) => (
    <PeopleSheet all={pool} picked={picked} close={close} onSave={(ids) => { setPicked(ids); savePeople(ids); }} />
  ));
  const openRates = (d: Driver) => staff && sheet.open((close) => (
    <Sheet title={`${d.name} 근무별 수당`} onClose={close} footer={<button className="primary" onClick={close}>닫기</button>}>
      <PayRatesCard driverId={d.id} />
    </Sheet>
  ));
  const sticky = { position: 'sticky', left: 0, background: '#fff', zIndex: 1 } as const;

  return (
    <div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {([['month', '월별'], ['week', '주별'], ['range', '기간']] as [Mode, string][]).map(([m, l]) => (
          <button key={m} className={`chip ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{l}</button>
        ))}
        <span style={{ width: 8 }} />
        {([['기사', '기사'], ['현장', '현장'], ['사무', '사무'], ['all', '전체']] as [StaffType, string][]).map(([t, l]) => (
          <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>{l}</button>
        ))}
      </div>
      {mode === 'range' ? (
        <div className="row" style={{ alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <input type="date" value={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} />
          <span>~</span>
          <input type="date" value={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
      ) : (
        <div className="datebar">
          <button onClick={() => move(-1)}>◀</button>
          <div className="date" onClick={() => setAnchor(today)}>{title}</div>
          <button onClick={() => move(1)}>▶</button>
        </div>
      )}
      <div className="row" style={{ alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <button className="chip" onClick={pickPeople}>👥 인원 선택 {narrowed ? `(${drivers.length}/${pool.length}명)` : `(전체 ${pool.length}명)`}</button>
        {narrowed && <button className="chip" onClick={() => { setPicked(null); savePeople(null); }}>전체 보기</button>}
      </div>
      <p className="muted small" style={{ margin: '0 0 6px' }}>
        칸을 누르면 근무형태를 넣습니다{staff ? ' · 이름을 누르면 근무별 수당' : ''}. {WORK_TYPES.map((t) => `${WORK_TYPE_SHORT[t]}=${t}`).join(' · ')} · <b style={{ background: 'var(--yellow-soft)' }}>배·현</b>=배차·현장 잡혔지만 형태 미입력 · 휴=휴무 · 회색=근무일 아님
      </p>
      <div className="att-wrap">
        <table className="simple small att-table">
          <thead>
            <tr>
              <th style={{ ...sticky, zIndex: 3, width: 64 }}>날짜</th>
              {rows.map((r) => (
                <th key={r.driver.id} className="att-name" onClick={() => openRates(r.driver)} style={{ cursor: staff ? 'pointer' : 'default' }}>
                  {r.driver.name}
                  <div className="muted" style={{ fontSize: 10, fontWeight: 400 }}>{r.driver.shift === ON_CALL_SHIFT ? '알바' : driverGroup(r.driver)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((date, j) => {
              const wd = weekdayOf(date);
              return (
                <tr key={date} style={{ background: date === today ? '#fee2e2' : undefined }}>
                  <td style={{ ...sticky, background: date === today ? '#fee2e2' : '#fff', fontWeight: 700, whiteSpace: 'nowrap', color: wd === 0 ? 'var(--red)' : wd === 6 ? 'var(--blue)' : undefined }}>{dayLabel(date)}</td>
                  {rows.map((r) => {
                    const c = r.days[j];
                    return (
                      <td
                        key={r.driver.id}
                        title={[c.types.join(', '), c.memo].filter(Boolean).join(' · ')}
                        onClick={() => staff && void pick.workType(c.date, r.driver.id)}
                        className="att-cell"
                        style={{
                          cursor: staff ? 'pointer' : 'default',
                          background: c.assigned && !c.types.length ? 'var(--yellow-soft)' : !c.scheduled && !cellText(c) ? '#f3f4f6' : undefined,
                          color: c.off ? 'var(--red)' : '#1d4ed8',
                        }}
                      >
                        {cellText(c)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="att-sum"><td style={sticky}>근무일</td>{rows.map((r) => <td key={r.driver.id}><b>{r.workedDays}</b></td>)}</tr>
            {WORK_TYPES.filter((t) => rows.some((r) => r.byType[t])).map((t) => (
              <tr key={t} className="att-sum"><td style={sticky}>{t}</td>{rows.map((r) => <td key={r.driver.id}>{r.byType[t] || ''}</td>)}</tr>
            ))}
            {rows.some((r) => r.missingType) && (
              <tr className="att-sum"><td style={sticky}>미입력</td>{rows.map((r) => <td key={r.driver.id} style={{ color: '#a16207' }}>{r.missingType || ''}</td>)}</tr>
            )}
            {staff && (
              <tr className="att-sum pay"><td style={sticky}>수당</td>{rows.map((r, i) => <td key={r.driver.id}>{pays[i].total ? won(pays[i].total) : ''}</td>)}</tr>
            )}
          </tfoot>
        </table>
      </div>

      {staff && (
        <>
          <h3>근무별 수당 합계 <span className="muted small">({title})</span></h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="simple small">
              <thead><tr><th>이름</th><th>내역 (횟수 × 수당)</th><th className="num">합계</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const p = pays[i];
                  const parts = WORK_TYPES.filter((t) => p.byType[t] != null).map((t) => `${t} ${r.byType[t]}회 ${won(p.byType[t]!)}`);
                  return (
                    <tr key={r.driver.id} onClick={() => openRates(r.driver)} style={{ cursor: 'pointer' }}>
                      <td style={{ whiteSpace: 'nowrap' }}><b>{r.driver.name}</b></td>
                      <td>
                        {parts.join(' · ') || <span className="muted">-</span>}
                        {p.missingRate.length > 0 && <div style={{ color: '#a16207', fontSize: 12 }}>수당 미입력: {p.missingRate.map((t) => `${t} ${r.byType[t]}회`).join(', ')}</div>}
                        {r.missingType > 0 && <div style={{ color: '#a16207', fontSize: 12 }}>근무형태 미입력 {r.missingType}일 (계산 안 됨)</div>}
                      </td>
                      <td className="num"><b>{p.total ? won(p.total) : ''}</b></td>
                    </tr>
                  );
                })}
                <tr><td><b>합계</b></td><td /><td className="num"><b>{won(pays.reduce((s, p) => s + p.total, 0))}</b></td></tr>
              </tbody>
            </table>
          </div>
        </>
      )}
      <button style={{ marginTop: 10 }} onClick={() => exportAttendance(snap, title, rows, staff)}>⬇ 엑셀로 내려받기</button>
    </div>
  );
}
