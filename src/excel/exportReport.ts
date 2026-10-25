// 관리 화면 표 → 엑셀 (시트 여러 개 가능)
import { boxBorder, download, fill, header, newWorkbook } from './common.ts';

export interface ReportColumn { key: string; label: string; num?: boolean; width?: number }
export type ReportRow = Record<string, string | number | null | undefined>;
export interface ReportSheet { name: string; title: string; columns: ReportColumn[]; rows: ReportRow[]; totals?: ReportRow }

export async function exportReport(filename: string, sheets: ReportSheet[]) {
  const wb = await newWorkbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.replace(/[\\/?*[\]:]/g, '-').slice(0, 31)); // 엑셀 시트 이름에 못 쓰는 글자
    const n = s.columns.length;
    ws.mergeCells(1, 1, 1, Math.max(n, 2));
    ws.getCell(1, 1).value = s.title;
    ws.getCell(1, 1).font = { bold: true, size: 15 };
    header(ws, 3, s.columns.map((c) => c.label));
    s.columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width ?? (c.num ? 12 : 14)));
    const all = s.totals ? [...s.rows, s.totals] : s.rows;
    all.forEach((r, j) => {
      s.columns.forEach((c, i) => {
        const cell = ws.getCell(4 + j, i + 1);
        const v = r[c.key];
        cell.value = v ?? '';
        if (c.num && typeof v === 'number') { cell.numFmt = '#,##0'; cell.alignment = { horizontal: 'right' }; }
        if (s.totals && j === all.length - 1) { cell.font = { bold: true }; fill(cell, 'FFF3F4F6'); }
      });
    });
    if (all.length) boxBorder(ws, 3, 1, 3 + all.length, n, { style: 'thin', color: { argb: 'FF9CA3AF' } } as never);
    ws.views = [{ state: 'frozen', ySplit: 3 }];
  }
  await download(wb, filename);
}
