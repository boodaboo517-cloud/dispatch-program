import {
  CALC_LABEL, revenueLines, type Snapshot,
} from '../domain/index.ts';
import { clientName, kindLabel, productName, ZONE_LABEL, vehicleNo, driverName } from '../ui/labels.ts';
import { boxBorder, download, header, newWorkbook } from './common.ts';

/** 거래처별 청구 내역서 (거래처마다 시트 1장) */
export async function exportBilling(s: Snapshot, from: string, to: string, clientIds?: string[]) {
  const wb = await newWorkbook();
  const lines = revenueLines(s, from, to);
  const byClient = new Map<string, typeof lines>();
  for (const l of lines) {
    const id = l.rev?.bill_to_client_id ?? l.order.client_id ?? '(거래처 없음)';
    if (clientIds && !clientIds.includes(id)) continue;
    if (!byClient.has(id)) byClient.set(id, []);
    byClient.get(id)!.push(l);
  }
  for (const [cid, ls] of byClient) {
    const name = s.clients.find((c) => c.id === cid)?.name ?? cid;
    const ws = wb.addWorksheet(name.slice(0, 28));
    ws.columns = [11, 7, 7, 14, 10, 8, 10, 11, 12, 12, 11, 12, 8].map((w) => ({ width: w }));
    ws.mergeCells(1, 1, 1, 13);
    ws.getCell(1, 1).value = '청구 내역서';
    ws.getCell(1, 1).font = { bold: true, size: 18 };
    ws.getCell(1, 1).alignment = { horizontal: 'center' };
    ws.getCell(3, 1).value = `거래처: ${name}`;
    ws.getCell(4, 1).value = `기간: ${from} ~ ${to}`;
    ws.getCell(5, 1).value = '공급자: 경민물류';
    header(ws, 7, ['날짜', '구역', '구분', '품목', '지역', '수량', '계산', '단가', '추가요금', '공급가', '부가세', '합계', '상태']);
    let r = 8;
    let sup = 0, vat = 0, tot = 0;
    for (const l of ls) {
      const o = l.order;
      const extra = (l.rev?.extras ?? []).reduce((a, e) => a + e.amount, 0);
      ws.getRow(r).values = [
        o.date, ZONE_LABEL[o.zone], kindLabel(o.zone, o.kind), productName(s, o) || clientName(s, o), o.region,
        o.quantity ?? '', l.rev ? CALC_LABEL[l.rev.calc_method] : '', l.rev?.unit_price ?? '', extra || '',
        l.rev?.supply_amount ?? '', l.rev?.vat ?? '', l.rev?.total ?? '미입력', l.rev?.billing_status ?? '미청구',
      ];
      sup += l.rev?.supply_amount ?? 0;
      vat += l.rev?.vat ?? 0;
      tot += l.rev?.total ?? 0;
      r++;
    }
    ws.getRow(r).values = ['합계', '', '', '', '', '', '', '', '', sup, vat, tot, ''];
    ws.getRow(r).font = { bold: true };
    boxBorder(ws, 7, 1, r, 13, { style: 'thin', color: { argb: 'FF9CA3AF' } } as never);
    for (let i = 8; i <= r; i++) for (const c of [8, 9, 10, 11, 12]) ws.getCell(i, c).numFmt = '#,##0';
  }
  if (!byClient.size) wb.addWorksheet('내역 없음');
  await download(wb, `청구내역서 ${from}~${to}.xlsx`);
}

/** 매출 목록 (일·월·거래처·차량별 합계 포함) */
export async function exportRevenue(s: Snapshot, from: string, to: string) {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('매출');
  ws.columns = [11, 7, 7, 14, 14, 8, 8, 12, 12, 12, 8].map((w) => ({ width: w }));
  header(ws, 1, ['날짜', '구역', '구분', '거래처', '품목', '수량', '차량', '공급가', '부가세', '합계', '상태']);
  revenueLines(s, from, to).forEach((l, i) => {
    const o = l.order;
    ws.getRow(i + 2).values = [o.date, ZONE_LABEL[o.zone], kindLabel(o.zone, o.kind), clientName(s, o), productName(s, o), o.quantity ?? '',
      vehicleNo(s, o.vehicle_id), l.rev?.supply_amount ?? '', l.rev?.vat ?? '', l.rev?.total ?? '미입력', l.rev?.billing_status ?? '미청구'];
  });
  await download(wb, `매출 ${from}~${to}.xlsx`);
}

export async function exportMaintenance(s: Snapshot, from: string, to: string, vehicleId?: string) {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('정비 이력');
  ws.columns = [8, 12, 11, 11, 10, 10, 12, 10, 24].map((w) => ({ width: w }));
  header(ws, 1, ['차량', '정비 종류', '시작일', '종료일', '정비업체', '주행거리', '금액', '담당', '메모']);
  const recs = s.maintenance_records
    .filter((r) => r.start_date <= to && (r.end_date ?? r.start_date) >= from && (!vehicleId || r.vehicle_id === vehicleId))
    .sort((a, b) => vehicleNo(s, a.vehicle_id).localeCompare(vehicleNo(s, b.vehicle_id)) || a.start_date.localeCompare(b.start_date));
  recs.forEach((r, i) => {
    ws.getRow(i + 2).values = [vehicleNo(s, r.vehicle_id), r.kind, r.start_date, r.end_date ?? '정비 중', r.shop, r.odometer_km ?? '', r.cost ?? '', driverName(s, r.staff_id), r.memo];
    ws.getCell(i + 2, 7).numFmt = '#,##0';
  });
  await download(wb, `정비이력 ${from}~${to}.xlsx`);
}
