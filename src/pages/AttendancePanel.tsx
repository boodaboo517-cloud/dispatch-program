// 월간 기사 근무현황: 기사 × 날짜 표, 칸을 누르면 근무형태 입력
import { useMemo, useState } from 'react';
import {
  ON_CALL_SHIFT, WORK_TYPES, driverGroup, WORK_TYPE_SHORT, monthlyDriverStatus, weekdayOf, type DayCell, type DriverMonth, type Snapshot,
} from '../domain/index.ts';
import { boxBorder, download, fill, header, newWorkbook } from '../excel/common.ts';
import { dayjs, seoulToday } from '../lib/time.ts';
import { useRole, useSnap } from '../ui/hooks.ts';
import { usePickers } from '../ui/pickers.tsx';

function cellText(c: DayCell) {
  if (c.off) return '휴';
  if (c.types.length) return c.types.map((t) => WORK_TYPE_SHORT[t]).join('');
  if (c.assigned) return '배';
  return '';
}

async function exportAttendance(snap: Snapshot, month: string, rows: DriverMonth[]) {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet(`${month} 근무현황`);
  const days = rows[0]?.days ?? [];
  ws.mergeCells(1, 1, 1, days.length + 3 + WORK_TYPES.length);
  ws.getCell(1, 1).value = `경민물류 기사 근무현황 ${dayjs(`${month}-01`).format('YYYY년 M월')}`;
  ws.getCell(1, 1).font = { bold: true, size: 16 };
  header(ws, 3, ['기사', '근무조', ...days.map((d) => `${Number(d.date.slice(8))}`), '근무일', ...WORK_TYPES]);
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 9;
  days.forEach((_, i) => (ws.getColumn(3 + i).width = 4.5));
  rows.forEach((r, i) => {
    const row = 4 + i;
    ws.getCell(row, 1).value = r.driver.name;
    ws.getCell(row, 2).value = r.driver.shift;
    r.days.forEach((c, j) => {
      const cell = ws.getCell(row, 3 + j);
      cell.value = cellText(c);
      cell.alignment = { horizontal: 'center' };
      if (c.memo) cell.note = c.memo;
      if (!c.scheduled && !cellText(c)) fill(cell, 'FFF3F4F6');
      if (c.assigned && !c.types.length) fill(cell, 'FFFEF9C3');
    });
    ws.getCell(row, 3 + days.length).value = r.workedDays;
    WORK_TYPES.forEach((t, k) => (ws.getCell(row, 4 + days.length + k).value = r.byType[t] || ''));
  });
  boxBorder(ws, 3, 1, 3 + rows.length, days.length + 3 + WORK_TYPES.length, { style: 'thin', color: { argb: 'FF9CA3AF' } } as never);
  ws.getCell(5 + rows.length, 1).value = `약자: ${WORK_TYPES.map((t) => `${WORK_TYPE_SHORT[t]}=${t}`).join(', ')}, 배=배차(형태 미입력), 휴=휴무`;
  void snap;
  await download(wb, `기사근무현황 ${month}.xlsx`);
}

export function AttendancePanel() {
  const snap = useSnap();
  const pick = usePickers();
  const { staff } = useRole();
  const [month, setMonth] = useState(seoulToday().slice(0, 7));
  const from = `${month}-01`;
  const to = dayjs(from).endOf('month').format('YYYY-MM-DD');
  const drivers = useMemo(
    () => snap.drivers.filter((d) => d.staff_type === '기사')
      .sort((a, b) => driverGroup(a).localeCompare(driverGroup(b), 'ko', { numeric: true }) || a.name.localeCompare(b.name, 'ko')),
    [snap.drivers],
  );
  const rows = useMemo(() => monthlyDriverStatus(snap, from, to, drivers), [snap, from, to, drivers]);
  const move = (n: number) => setMonth(dayjs(from).add(n, 'month').format('YYYY-MM'));
  const today = seoulToday();

  return (
    <div>
      <div className="datebar">
        <button onClick={() => move(-1)}>◀</button>
        <div className="date">{dayjs(from).format('YYYY년 M월')} 기사 근무현황</div>
        <button onClick={() => move(1)}>▶</button>
      </div>
      <p className="muted small">
        칸을 누르면 근무형태를 넣습니다. {WORK_TYPES.map((t) => `${WORK_TYPE_SHORT[t]}=${t}`).join(' · ')} · <b style={{ background: 'var(--yellow-soft)' }}>배</b>=배차됐지만 형태 미입력 · 휴=휴무 · 회색=근무일 아님
      </p>
      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 10 }}>
        <table className="simple small" style={{ minWidth: 900, tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: 84, position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>기사</th>
              {rows[0]?.days.map((c) => (
                <th key={c.date} style={{ width: 34, textAlign: 'center', padding: '4px 0', color: weekdayOf(c.date) === 0 ? 'var(--red)' : weekdayOf(c.date) === 6 ? 'var(--blue)' : undefined, background: c.date === today ? '#fee2e2' : undefined }}>
                  {Number(c.date.slice(8))}
                </th>
              ))}
              <th style={{ width: 52 }} className="num">근무일</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.driver.id}>
                <td style={{ position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>
                  <b>{r.driver.name}</b>
                  <div className="muted" style={{ fontSize: 11 }}>{r.driver.shift === ON_CALL_SHIFT ? '알바' : driverGroup(r.driver)}</div>
                </td>
                {r.days.map((c) => (
                  <td
                    key={c.date}
                    title={[c.types.join(', '), c.memo].filter(Boolean).join(' · ')}
                    onClick={() => staff && void pick.workType(c.date, r.driver.id)}
                    style={{
                      textAlign: 'center', padding: '6px 0', cursor: staff ? 'pointer' : 'default', fontWeight: 700, fontSize: 12,
                      background: c.assigned && !c.types.length ? 'var(--yellow-soft)' : !c.scheduled && !cellText(c) ? '#f3f4f6' : undefined,
                      color: c.off ? 'var(--red)' : '#1d4ed8',
                    }}
                  >
                    {cellText(c)}
                  </td>
                ))}
                <td className="num"><b>{r.workedDays}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>형태별 합계</h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="simple small">
          <thead><tr><th>기사</th><th className="num">근무일</th>{WORK_TYPES.map((t) => <th key={t} className="num" title={t} style={{ whiteSpace: 'nowrap' }}>{WORK_TYPE_SHORT[t]}</th>)}<th className="num" style={{ whiteSpace: 'nowrap' }} title="배차됐지만 근무형태 미입력">미입력</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.driver.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{r.driver.name}</td>
                <td className="num"><b>{r.workedDays}</b></td>
                {WORK_TYPES.map((t) => <td key={t} className="num">{r.byType[t] || ''}</td>)}
                <td className="num" style={{ color: r.missingType ? '#a16207' : undefined }}>{r.missingType || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button style={{ marginTop: 10 }} onClick={() => exportAttendance(snap, month, rows)}>⬇ 엑셀로 내려받기</button>
    </div>
  );
}
