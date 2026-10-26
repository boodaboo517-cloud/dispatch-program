import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../../data/demo.ts';
import { fillDaySheet } from '../../excel/exportSchedule.ts';
import { planUpload } from '../../excel/importer.ts';
import { buildBoard, setRowNightDriver } from '../board.ts';
import { Tx, applyMutations } from '../tx.ts';

describe('엑셀', () => {
  it('일정표 양식: 차량 줄·배차 대기 노란 칸·현장근무가 들어간다', () => {
    const s = demoSnapshot('2026-10-21');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('t');
    fillDaySheet(ws, s, '2026-10-21');
    const cells: string[] = [];
    let yellow = 0;
    ws.eachRow((r) => r.eachCell({ includeEmpty: true }, (c) => {
      cells.push(String(c.value ?? ''));
      if ((c.fill as { fgColor?: { argb?: string } })?.fgColor?.argb === 'FFFDE047') yellow++;
    }));
    const text = cells.join('|');
    expect(text).toContain('9914');
    expect(text).toContain('제주로지'); // 축약 없이 전체
    expect(text).toContain('양선이');
    expect(text).toContain('경리업무');
    expect(yellow).toBeGreaterThan(0);
  });

  it('일정표 양식: 야간 기사는 상차 기사 칸에 "기사 / 야간:이름", 기사 근무에 🌙', () => {
    const base = demoSnapshot('2026-10-21');
    const row = buildBoard(base, '2026-10-21').rows.find((r) => r.loads.length || r.unloads.length)!;
    const night = base.drivers.find((d) => d.staff_type === '기사' && d.id !== row.driverId && d.id !== row.loadDriverId)!;
    const tx = new Tx(base);
    setRowNightDriver(tx, { date: '2026-10-21', vehicle_id: row.vehicle.id, zone: row.zone, driver_id: night.id });
    const s = applyMutations(base, tx.mutations());
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('t');
    fillDaySheet(ws, s, '2026-10-21');
    const cells: string[] = [];
    ws.eachRow((r) => r.eachCell((c) => { cells.push(String(c.value ?? '')); }));
    expect(cells.some((c) => c.includes(` / 야간:${night.name}`) || c === `야간:${night.name}`)).toBe(true);
    expect(cells.some((c) => c.includes(`🌙${night.name}`))).toBe(true);
  });

  it('업로드: 오류 행 표시, 정상 행만 반영 + 상차는 연결 하차 생성', () => {
    const s = demoSnapshot('2026-10-21');
    const preview = planUpload(s, {
      거래처: [{ line: 2, v: ['새거래처', '', '', '', ''] }],
      오더: [
        { line: 2, v: ['2026-10-22', '육지', '상차', '새거래처', '', '부산', '3', '파렛트', '', '9915', '', '제이엘', ''] },
        { line: 3, v: ['10/22', '바다', '상차', '', '', '', 'x', '', '', '0000', '', '', ''] },
      ],
    });
    expect(preview.filter((p) => p.errors.length)).toHaveLength(1);
    expect(preview.find((p) => p.line === 3 && p.sheet === '오더')!.errors.length).toBeGreaterThan(2);
  });
});
