import type { Borders, Cell, Workbook, Worksheet } from 'exceljs';

export async function newWorkbook(): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = '경민물류 배차';
  wb.created = new Date();
  return wb;
}

export async function download(wb: Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export const RED = 'FFB91C1C';
export const YELLOW = 'FFFDE047';
export const GRAY = 'FFD1D5DB';
export const HEAD = 'FF374151';

const thin = { style: 'thin' as const, color: { argb: GRAY } };
const red = { style: 'medium' as const, color: { argb: RED } };

export function fill(c: Cell, argb: string) {
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/** 차량 묶음마다 빨간 테두리: 바깥은 빨간 굵은 선, 안쪽은 회색 */
export function boxBorder(ws: Worksheet, r1: number, c1: number, r2: number, c2: number, outer = red) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const b: Partial<Borders> = {
        top: r === r1 ? outer : thin,
        bottom: r === r2 ? outer : thin,
        left: c === c1 ? outer : thin,
        right: c === c2 ? outer : thin,
      };
      ws.getCell(r, c).border = b;
    }
  }
}

export function header(ws: Worksheet, row: number, values: string[], startCol = 1, color = HEAD) {
  values.forEach((v, i) => {
    const c = ws.getCell(row, startCol + i);
    c.value = v;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    fill(c, color);
    c.border = { top: thin, bottom: thin, left: thin, right: thin };
  });
}
