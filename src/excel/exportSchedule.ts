// 기존 "경민물류 일정표" 양식으로 내보내기 (하루 = 시트 1장). 엑셀에는 축약 없이 전체 내용.
import type { Worksheet } from 'exceljs';
import {
  DAY_STATUS_LABEL, fieldDayOf, missingDriver, pmArrival, shownMemo, workText, seqMark, buildBoard, transportSummary, buildIndex, eachDay, isDriverWorking, sitesGrouped,
  type BoardRow, type DailyOrder, type Snapshot, type Zone,
} from '../domain/index.ts';
import { dayjs } from '../lib/time.ts';
import { clientName, driverName, productName, productOf, qtyText, setting, shipText, vehicleNo } from '../ui/labels.ts';
import { RED, YELLOW, boxBorder, download, fill, header, newWorkbook } from './common.ts';

const COLS = 16; // 상행선박 차량 기사 업체 지역 품목 수량 비고 | 차량 기사 업체 지역 품목 수량 비고 하행선박

function orderVals(s: Snapshot, o: DailyOrder | undefined) {
  if (!o) return ['', '', '', '', ''];
  const places = o.pickup_place || o.dropoff_place ? `${o.pickup_place || ''}→${o.dropoff_place || ''}` : '';
  const ext = o.carrier_type && o.carrier_type !== 'own' && o.vehicle_id ? transportSummary(s, o) : '';
  const extra = o.kind === 'load' ? [o.shipment === 'bulk' ? '벌크' : '', o.same_day ? '당일왕복' : '', !o.same_day && o.arrival_offset != null ? `하차+${o.arrival_offset}일` : ''] : [];
  // 냉동(파랑)·냉장(하늘색): 품목명 뒤에 작은 글씨
  const st = productOf(s, o)?.storage;
  const product = st && st !== 'ambient'
    ? { richText: [{ text: productName(s, o) }, { text: ` ${st === 'frozen' ? '냉동' : '냉장'}`, font: { size: 6, bold: true, color: { argb: st === 'frozen' ? 'FF1D4ED8' : 'FF0EA5E9' } } }] }
    : productName(s, o);
  return [clientName(s, o), o.region, product, qtyText(o), [workText(o), places, ...extra, ext, shownMemo(s, o)].filter(Boolean).join(' ')];
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
    // 전날 대기 짐 [[ ]] 과 칸 비고(오더 없이)도 줄로 넣는다
    // 야간 작업은 상차 칸 아래에 "(야간)"으로
    // 오후도착: 하차는 오후(상차) 칸에 "(하차)"로, 오후 기사가
    const pm = pmArrival(row);
    const unloads = pm ? [] : row.unloads;
    const loadList = [...(pm ? row.unloads : []), ...row.carried, ...row.loads, ...row.nights];
    const uLines = unloads.length + (row.unloadNote ? 1 : 0);
    const lLines = loadList.length + (row.loadNote ? 1 : 0);
    const n = Math.max(uLines, lLines, 1);
    const hasOrders = uLines + lLines > 0;
    const seq = (n: number | null) => (n ? ` ${seqMark(n)}` : '');
    const drv = row.driverId && row.driverId === row.nightDriverId ? `야간:${driverName(s, row.driverId)}`
      : driverName(s, row.driverId) ? driverName(s, row.driverId) + seq(row.unloadSeq) : row.amLabel || (missingDriver(row, 'unload') ? '미배치' : '');
    const helper = row.helperId ? ` +${driverName(s, row.helperId)}${row.helperRole ? `(${row.helperRole})` : ''}` : '';
    // 상차 기사 칸: "김재표 / 야간:최현수" (상차 기사가 미배치여도 야간 기사가 있으면 "야간:최현수"만)
    const nightName = row.nightDriverId ? driverName(s, row.nightDriverId) : row.nights.length ? '미배치' : '';
    const dayLoad = row.loadDriverId === row.nightDriverId ? '' : driverName(s, row.loadDriverId) ? driverName(s, row.loadDriverId) + seq(row.loadSeq) : missingDriver(row, 'load') && !row.nightDriverId ? '미배치' : '';
    const loadDrv = [dayLoad, nightName && `야간:${nightName}`].filter(Boolean).join(' / ') + helper;
    const night = nightName ? loadDrv.indexOf('야간:') : -1;
    for (let i = 0; i < n; i++) {
      const line = ws.getRow(r + i);
      if (hasOrders) {
        orderVals(s, unloads[i]).forEach((v, k) => (line.getCell(4 + k).value = v));
        orderVals(s, loadList[i]).forEach((v, k) => (line.getCell(11 + k).value = v));
        if (row.carried.includes(loadList[i])) line.getCell(11).value = `[[ ${line.getCell(11).value ?? ''} ]]`;
        if (pm && row.unloads.includes(loadList[i])) line.getCell(11).value = `(하차) ${line.getCell(11).value ?? ''}`;
        if (row.nights.includes(loadList[i])) line.getCell(11).value = `(야간${loadList[i].kind === 'unload' ? ' 하차' : ''}) ${line.getCell(11).value ?? ''}`;
        if (row.unloadNote && i === unloads.length) line.getCell(4).value = row.unloadNote;
        if (row.loadNote && i === loadList.length) line.getCell(11).value = row.loadNote;
      }
    }
    const first = ws.getRow(r);
    first.getCell(1).value = shipText(row.arrivalShip, row.arrivalTag);
    first.getCell(2).value = row.vehicle.short_no;
    first.getCell(3).value = drv + helper + (row.startTime || row.startPlace ? ` (출근 ${[row.startTime, row.startPlace].filter(Boolean).join(' ')})` : '');
    // 야간 상차 뒤 아침 배는 "(익일)"
    const nextDay = !!row.departureShip && row.nights.some((o) => o.kind === 'load' && o.departure_ship === row.departureShip)
      && !row.loads.some((o) => o.departure_ship === row.departureShip);
    first.getCell(16).value = shipText(row.departureShip, row.departureTag) + (nextDay ? ' (익일)' : '');
    if (hasOrders) {
      first.getCell(9).value = row.vehicle.short_no;
      // "야간"은 빨간 글씨
      first.getCell(10).value = night < 0 ? loadDrv : { richText: [
        { text: loadDrv.slice(0, night) },
        { text: '야간', font: { bold: true, color: { argb: 'FFDC2626' } } },
        { text: loadDrv.slice(night + 2) },
      ] };
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
  // 기사 근무: 배차된 기사, 그 뒤에 빨간 "야간" + 야간 기사
  const dayIds = new Set(rows.flatMap((x) => [x.driverId, x.loadDriverId, x.helperId].filter((id) => !x.secondary || id !== x.nightDriverId)).filter((x): x is string => !!x));
  const nightIds = new Set(rows.map((x) => x.nightDriverId).filter((x): x is string => !!x));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ko');
  const dayNames = s.drivers.filter((d) => dayIds.has(d.id)).sort(byName).map((d) => d.name);
  const nightNames = s.drivers.filter((d) => nightIds.has(d.id)).sort(byName).map((d) => d.name);
  if (dayNames.length || nightNames.length) {
    ws.getCell(r, 1).value = '기사 근무';
    ws.getCell(r, 1).font = { bold: true };
    ws.mergeCells(r, 2, r, COLS);
    ws.getCell(r, 2).value = { richText: [
      { text: dayNames.join(', ') },
      ...nightNames.flatMap((n, i) => [{ text: i || dayNames.length ? ', ' : '' }, { text: '야간', font: { bold: true, color: { argb: 'FFDC2626' } } }, { text: ` ${n}` }]),
    ] };
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
  // 한 사람 한 줄: 종일이면 업무 하나, 오전·오후가 다르면 "오전 … / 오후 …"
  const seen = new Set<string>();
  for (const g of groups) {
    const startRow = r;
    for (const f of g.rows) {
      if (!f.staff_id || seen.has(f.staff_id)) continue;
      seen.add(f.staff_id);
      const day = fieldDayOf(board.field, f.staff_id, date);
      const site = (id: string | null) => s.field_sites.find((x) => x.id === id)?.name ?? '';
      const halfText = (x: typeof day.am, label: string) => (x ? `${label} ${x.site_id !== day.site_id ? `[${site(x.site_id)}] ` : ''}${x.task}`.trim() : '');
      ws.getCell(r, 1).value = g.site.name;
      ws.getCell(r, 2).value = driverName(s, f.staff_id);
      ws.mergeCells(r, 3, r, 5);
      ws.getCell(r, 3).value = day.am && day.am === day.pm ? day.am.task : [halfText(day.am, '오전'), halfText(day.pm, '오후')].filter(Boolean).join(' / ');
      const v = s.vehicles.find((x) => x.id === day.vehicle_id);
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
  ws.getCell(r, 2).value = [...s.ships].filter((x) => x.departs_at).sort((a, b) => a.departs_at.localeCompare(b.departs_at)).map((x) => `${x.name} ${x.depart_next_day ? '익일 ' : ''}${x.departs_at}`).join('  ');
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
