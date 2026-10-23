// 기존 "경민물류 일정표" 양식으로 내보내기 (하루 = 시트 1장). 엑셀에는 축약 없이 전체 내용.
import type { Worksheet } from 'exceljs';
import {
  DAY_STATUS_LABEL, missingDriver, seqMark, buildBoard, transportSummary, buildIndex, eachDay, isDriverWorking, sitesGrouped,
  type BoardRow, type DailyOrder, type Snapshot, type Zone,
} from '../domain/index.ts';
import { dayjs } from '../lib/time.ts';
import { clientName, driverName, productName, qtyText, setting, shipText, vehicleNo } from '../ui/labels.ts';
import { RED, YELLOW, boxBorder, download, fill, header, newWorkbook } from './common.ts';

const COLS = 16; // 상행선박 차량 기사 업체 지역 품목 수량 비고 | 차량 기사 업체 지역 품목 수량 비고 하행선박

function orderVals(s: Snapshot, o: DailyOrder | undefined) {
  if (!o) return ['', '', '', '', ''];
  const places = o.pickup_place || o.dropoff_place ? `${o.pickup_place || ''}→${o.dropoff_place || ''}` : '';
  const ext = o.carrier_type && o.carrier_type !== 'own' && o.vehicle_id ? transportSummary(s, o) : '';
  const extra = o.kind === 'load' ? [o.shipment === 'bulk' ? '벌크' : '', o.same_day ? '당일왕복' : '', !o.same_day && o.arrival_offset != null ? `하차+${o.arrival_offset}일` : ''] : [];
  return [clientName(s, o), o.region, productName(s, o), qtyText(o), [places, ...extra, ext, o.memo].filter(Boolean).join(' ')];
}

function zoneTable(ws: Worksheet, s: Snapshot, start: number, zone: Zone, rows: BoardRow[], waiting: DailyOrder[], external: DailyOrder[] = []) {
  let r = start;
  const title = ws.getCell(r, 1);
  title.value = zone === 'land' ? '육지' : '제주';
  title.font = { bold: true, size: 14, color: { argb: RED } };
  r++;
  ws.mergeCells(r, 1, r, 8);
  ws.mergeCells(r, 9, r, 16);
  header(ws, r, [zone === 'land' ? '하차 내용' : '오전'], 1, RED);
  header(ws, r, [zone === 'land' ? '상차 내용' : '오후'], 9, RED);
  r++;
  header(ws, r, [
    zone === 'land' ? '상행선박' : '도착선박', '차량번호', '기사', '업체명', '지역', '품목', '수량', '비고',
    '차량번호', '기사', '업체명', '지역', '품목', '수량', '비고', zone === 'land' ? '하행선박' : '오후선박',
  ]);
  r++;
  for (const row of rows) {
    const n = Math.max(row.unloads.length, row.loads.length, 1);
    const hasOrders = row.unloads.length + row.loads.length > 0;
    const seq = (n: number | null) => (n ? ` ${seqMark(n)}` : '');
    const drv = driverName(s, row.driverId) ? driverName(s, row.driverId) + seq(row.unloadSeq) : missingDriver(row, 'unload') ? '미배치' : '';
    const helper = row.helperId ? ` +${driverName(s, row.helperId)}${row.helperRole ? `(${row.helperRole})` : ''}` : '';
    const loadDrv = (driverName(s, row.loadDriverId) ? driverName(s, row.loadDriverId) + seq(row.loadSeq) : missingDriver(row, 'load') ? '미배치' : '') + helper;
    for (let i = 0; i < n; i++) {
      const line = ws.getRow(r + i);
      if (hasOrders) {
        orderVals(s, row.unloads[i]).forEach((v, k) => (line.getCell(4 + k).value = v));
        orderVals(s, row.loads[i]).forEach((v, k) => (line.getCell(11 + k).value = v));
      }
    }
    const first = ws.getRow(r);
    first.getCell(1).value = shipText(row.arrivalShip, row.arrivalTag);
    first.getCell(2).value = row.vehicle.short_no;
    first.getCell(3).value = drv + helper + (row.startTime || row.startPlace ? ` (출근 ${[row.startTime, row.startPlace].filter(Boolean).join(' ')})` : '');
    first.getCell(16).value = shipText(row.departureShip, row.departureTag);
    if (hasOrders) {
      first.getCell(9).value = row.vehicle.short_no;
      first.getCell(10).value = loadDrv;
    } else {
      ws.mergeCells(r, 4, r, 15);
      first.getCell(4).value = [row.status && row.status !== 'field' ? DAY_STATUS_LABEL[row.status] : '', row.statusMemo].filter(Boolean).join(' · ');
    }
    if (n > 1) {
      for (const c of hasOrders ? [1, 2, 3, 9, 10, 16] : [1, 2, 3, 16]) ws.mergeCells(r, c, r + n - 1, c);
    }
    boxBorder(ws, r, 1, r + n - 1, COLS);
    r += n;
  }
  // 배차 대기: 차량번호 칸 비우고 노란 배경 / 용차·화주배차: 차량 칸에 업체·차량번호, 주황 배경
  for (const o of [...waiting, ...external]) {
    const ext = external.includes(o);
    const line = ws.getRow(r);
    const isLoad = o.kind === 'load';
    if (isLoad) {
      orderVals(s, o).forEach((v, k) => (line.getCell(11 + k).value = v));
      line.getCell(16).value = shipText(o.departure_ship, o.departure_ship_tag);
    } else {
      orderVals(s, o).forEach((v, k) => (line.getCell(4 + k).value = v));
      line.getCell(1).value = shipText(o.arrival_ship, o.arrival_ship_tag);
    }
    boxBorder(ws, r, 1, r, COLS, { style: 'medium', color: { argb: ext ? 'FFF97316' : 'FFEAB308' } } as never);
    const vcell = line.getCell(isLoad ? 9 : 2);
    if (ext) {
      vcell.value = [o.carrier_type === 'shipper' ? '화주배차' : '용차', o.carrier_vehicle].filter(Boolean).join(' ');
      line.getCell(isLoad ? 10 : 3).value = [o.carrier_name, o.carrier_phone].filter(Boolean).join(' ');
      fill(vcell, 'FFFFEDD5');
    } else fill(vcell, YELLOW);
    r++;
  }
  for (let i = start + 3; i < r; i++) {
    ws.getRow(i).alignment = { vertical: 'middle', wrapText: true };
    ws.getRow(i).height = 22;
  }
  return r + 1;
}

export function fillDaySheet(ws: Worksheet, s: Snapshot, date: string) {
  const board = buildBoard(s, date, buildIndex(s));
  const d = dayjs(date);
  ws.columns = [10, 8, 9, 14, 8, 12, 7, 14, 8, 9, 14, 8, 12, 7, 14, 10].map((w) => ({ width: w }));
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  ws.mergeCells(1, 1, 1, COLS);
  const t = ws.getCell(1, 1);
  t.value = setting(s, 'header_notice', '경민물류 일정표');
  t.font = { bold: true, size: 18 };
  t.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, COLS);
  const dc = ws.getCell(2, 1);
  dc.value = d.format('YYYY년 M월 D일 (ddd)');
  dc.font = { bold: true, size: 13 };
  dc.alignment = { horizontal: 'center' };

  // 상단 근무표
  const shifts = new Map<string, string[]>();
  for (const dr of s.drivers.filter((x) => x.staff_type === '기사')) {
    const key = dr.shift || '기타';
    if (!shifts.has(key)) shifts.set(key, []);
    shifts.get(key)!.push(dr.name + (isDriverWorking(s, dr, date) ? '' : '(휴)'));
  }
  ws.mergeCells(3, 1, 3, COLS);
  ws.getCell(3, 1).value = [...shifts.entries()].map(([k, v]) => `${k}: ${v.join(', ')}`).join('   ');
  ws.getCell(3, 1).font = { size: 10 };

  let r = 5;
  r = zoneTable(ws, s, r, 'land', board.land, board.waiting.land, board.external.land);
  r = zoneTable(ws, s, r, 'jeju', board.jeju, board.waiting.jeju, board.external.jeju);

  // 하단: 현장근무
  const { groups, off } = sitesGrouped(s, board.field);
  ws.getCell(r, 1).value = '현장근무';
  ws.getCell(r, 1).font = { bold: true, size: 13, color: { argb: RED } };
  r++;
  header(ws, r, ['근무지', '이름', '업무', '', '', '지급 차량']);
  ws.mergeCells(r, 3, r, 5);
  r++;
  for (const g of groups) {
    const startRow = r;
    for (const f of g.rows) {
      ws.getCell(r, 1).value = g.site.name;
      ws.getCell(r, 2).value = driverName(s, f.staff_id);
      ws.mergeCells(r, 3, r, 5);
      ws.getCell(r, 3).value = f.task;
      const v = s.vehicles.find((x) => x.id === f.vehicle_id);
      ws.getCell(r, 6).value = v ? `${v.vehicle_type} ${v.short_no}` : '';
      r++;
    }
    if (r > startRow) boxBorder(ws, startRow, 1, r - 1, 6);
  }
  r++;
  // 차량 목록 · 출항시간 · 휴무자
  ws.getCell(r, 1).value = '차량 위치';
  ws.getCell(r, 1).font = { bold: true };
  ws.mergeCells(r, 2, r, COLS);
  ws.getCell(r, 2).value = board.rows.map((x) => `${x.vehicle.short_no}(${x.zone === 'land' ? '육' : x.zone === 'jeju' ? '제' : '?'}${x.status && x.status !== 'field' ? '·' + DAY_STATUS_LABEL[x.status] : ''})`).join('  ')
    + (board.fieldVehicleIds.size ? `  / 현장: ${[...board.fieldVehicleIds].map((id) => vehicleNo(s, id)).join(', ')}` : '');
  r++;
  ws.getCell(r, 1).value = '출항시간';
  ws.getCell(r, 1).font = { bold: true };
  ws.mergeCells(r, 2, r, COLS);
  ws.getCell(r, 2).value = [...s.ships].filter((x) => x.departs_at).sort((a, b) => a.departs_at.localeCompare(b.departs_at)).map((x) => `${x.name} ${x.departs_at}`).join('  ');
  r++;
  ws.getCell(r, 1).value = '휴무자';
  ws.getCell(r, 1).font = { bold: true };
  ws.mergeCells(r, 2, r, COLS);
  ws.getCell(r, 2).value = off.map((f) => driverName(s, f.staff_id)).join(', ');
}

export async function exportSchedule(s: Snapshot, from: string, to: string) {
  const wb = await newWorkbook();
  for (const d of eachDay(from, to)) fillDaySheet(wb.addWorksheet(dayjs(d).format('M.D(ddd)')), s, d);
  await download(wb, from === to ? `경민물류 일정표 ${from}.xlsx` : `경민물류 일정표 ${from}~${to}.xlsx`);
}
