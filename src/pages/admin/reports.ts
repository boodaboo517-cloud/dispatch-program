// PC 관리 화면 표 만들기: 일별 배차현황 · 매출(일·월·기간·거래처) · 선박 이용현황
import {
  FARE_KIND_LABEL, buildBoard, bulkCosts, eachDay, missingDriver, revenueLines, shipCosts, workText,
  type BoardRow, type DailyOrder, type RevenueLine, type Snapshot, type Zone,
} from '../../domain/index.ts';
import type { ReportColumn, ReportRow, ReportSheet } from '../../excel/exportReport.ts';
import { dayjs } from '../../lib/time.ts';
import { clientName, driverName, productName, qtyText, vehicleNo } from '../../ui/labels.ts';

const ZONE: Record<Zone, string> = { land: '육지', jeju: '제주' };
const sideName = (z: Zone | null, kind: 'unload' | 'load') => (z === 'jeju' ? (kind === 'unload' ? '오전' : '오후') : kind === 'unload' ? '하차' : '상차');
const orderText = (snap: Snapshot, os: DailyOrder[]) => os.map((o) => [clientName(snap, o), productName(snap, o), qtyText(o), workText(o)].filter(Boolean).join(' ')).join(' / ');
const dayLabel = (d: string) => dayjs(d).format('M/D (dd)');

/** 일별 배차현황: 차량 한 대 = 한 줄 (육지 → 제주), 아래에 배차 대기·용차 */
export function dispatchReport(snap: Snapshot, date: string): { sheet: ReportSheet; summary: Record<string, number> } {
  const b = buildBoard(snap, date);
  const columns: ReportColumn[] = [
    { key: 'zone', label: '구역', width: 6 }, { key: 'veh', label: '차량', width: 8 }, { key: 'type', label: '차종', width: 8 },
    { key: 'arr', label: '도착선박', width: 12 }, { key: 'd1', label: '오전·하차 기사', width: 12 }, { key: 'u', label: '오전·하차 내용', width: 40 },
    { key: 'd2', label: '오후·상차 기사', width: 12 }, { key: 'l', label: '오후·상차 내용', width: 40 }, { key: 'dep', label: '출발선박', width: 12 },
    { key: 'nd', label: '야간 기사', width: 10 }, { key: 'n', label: '야간 내용', width: 30 },
    { key: 'st', label: '상태·비고', width: 18 },
  ];
  const rows: ReportRow[] = [];
  const line = (r: BoardRow) => ({
    zone: r.zone ? ZONE[r.zone] : '미정', veh: r.vehicle.short_no, type: r.vehicle.vehicle_type,
    arr: r.arrivalShip ?? '', d1: driverName(snap, r.driverId) || r.amLabel || (missingDriver(r, 'unload') ? '미배치' : ''),
    u: [orderText(snap, r.unloads), r.unloadNote].filter(Boolean).join(' / '),
    d2: r.loadDriverId !== r.driverId ? driverName(snap, r.loadDriverId) || (missingDriver(r, 'load') ? '미배치' : '') : '',
    l: [r.carried.length ? `[[ ${orderText(snap, r.carried)} ]]` : '', orderText(snap, r.loads), r.loadNote].filter(Boolean).join(' / '),
    dep: r.departureShip ?? '',
    nd: r.nights.length || r.nightDriverId ? driverName(snap, r.nightDriverId) || '미배치' : '',
    n: r.nights.map((o) => `${o.kind === 'load' ? '상차' : '하차'}${o.zone !== r.zone ? `(${ZONE[o.zone]})` : ''} ${orderText(snap, [o])}${o.departure_ship ? ` → ${o.departure_ship}` : ''}`).join(' / '),
    st: [r.inRepair ? '수리' : '', r.status === 'empty' ? '공차' : r.status === 'rest' ? '휴차' : '', r.statusMemo].filter(Boolean).join(' '),
  });
  for (const r of [...b.land, ...b.jeju]) rows.push(line(r));
  for (const z of ['land', 'jeju'] as Zone[]) {
    for (const o of b.waiting[z]) rows.push({ zone: ZONE[z], veh: '배차대기', [o.kind === 'unload' ? 'u' : 'l']: orderText(snap, [o]) });
    for (const o of b.external[z]) rows.push({ zone: ZONE[z], veh: o.carrier_type === 'shipper' ? '화주배차' : '용차', type: o.carrier_name ?? '', [o.kind === 'unload' ? 'u' : 'l']: orderText(snap, [o]) });
  }
  const all = [...b.land, ...b.jeju];
  const summary = {
    차량: all.filter((r) => !r.secondary).length,
    운행: all.filter((r) => r.unloads.length + r.loads.length + r.carried.length > 0).length,
    하차: all.reduce((a, r) => a + r.unloads.length, 0),
    상차: all.reduce((a, r) => a + r.loads.length, 0),
    배차대기: b.waiting.land.length + b.waiting.jeju.length,
    미배치: all.filter((r) => missingDriver(r, 'unload') || missingDriver(r, 'load') || (r.nights.length > 0 && !r.nightDriverId)).length,
    야간: all.reduce((a, r) => a + r.nights.length, 0),
    용차: b.external.land.length + b.external.jeju.length,
    수리: all.filter((r) => r.inRepair).length,
  };
  return { sheet: { name: `배차 ${date}`, title: `경민물류 일별 배차현황 ${dayjs(date).format('YYYY년 M월 D일 (dd)')}`, columns, rows }, summary };
}

const money = (l: RevenueLine) => ({ supply: l.rev?.supply_amount ?? null, vat: l.rev?.vat ?? null, total: l.rev?.total ?? null });
const MONEY_COLS: ReportColumn[] = [{ key: 'supply', label: '공급가', num: true }, { key: 'vat', label: '부가세', num: true }, { key: 'total', label: '합계', num: true }];

function sumRow(rows: ReportRow[], label: Record<string, string>): ReportRow {
  const t: ReportRow = { ...label };
  for (const k of ['count', 'supply', 'vat', 'total', 'missing', 'unbilled', 'unpaid']) {
    const vs = rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number');
    if (vs.length) t[k] = vs.reduce((a, b) => a + b, 0);
  }
  return t;
}

/** 매출 목록 (하루 또는 기간): 오더 한 건 = 한 줄 */
export function revenueListReport(snap: Snapshot, from: string, to: string, title: string): ReportSheet {
  const lines = revenueLines(snap, from, to);
  const columns: ReportColumn[] = [
    { key: 'date', label: '날짜', width: 10 }, { key: 'zone', label: '구역', width: 6 }, { key: 'kind', label: '구분', width: 6 },
    { key: 'client', label: '거래처', width: 16 }, { key: 'product', label: '품목', width: 16 }, { key: 'qty', label: '수량', width: 9 },
    { key: 'veh', label: '차량', width: 8 }, ...MONEY_COLS, { key: 'status', label: '청구', width: 8 },
  ];
  const rows: ReportRow[] = lines.map((l) => ({
    date: dayLabel(l.order.date), zone: ZONE[l.order.zone], kind: sideName(l.order.zone, l.order.kind),
    client: clientName(snap, l.order), product: productName(snap, l.order), qty: qtyText(l.order),
    veh: l.order.carrier_type && l.order.carrier_type !== 'own' ? (l.order.carrier_type === 'shipper' ? '화주' : '용차') : vehicleNo(snap, l.order.vehicle_id) || '미배차',
    ...money(l), status: l.rev?.total == null ? '금액 미입력' : l.rev.billing_status,
  }));
  return { name: title.slice(0, 31), title, columns, rows, totals: sumRow(rows, { date: '합계' }) };
}

/** 월 매출: 날짜별 합계 */
export function monthlyReport(snap: Snapshot, month: string): ReportSheet {
  const from = `${month}-01`;
  const to = dayjs(from).endOf('month').format('YYYY-MM-DD');
  const lines = revenueLines(snap, from, to);
  const rows: ReportRow[] = [...eachDay(from, to)].map((d) => {
    const ls = lines.filter((l) => l.order.date === d);
    const priced = ls.filter((l) => l.rev?.total != null);
    return {
      date: dayLabel(d), count: ls.length || null,
      supply: priced.length ? priced.reduce((a, l) => a + (l.rev!.supply_amount ?? 0), 0) : null,
      vat: priced.length ? priced.reduce((a, l) => a + (l.rev!.vat ?? 0), 0) : null,
      total: priced.length ? priced.reduce((a, l) => a + (l.rev!.total ?? 0), 0) : null,
      missing: ls.length - priced.length || null,
    };
  });
  const columns: ReportColumn[] = [{ key: 'date', label: '날짜', width: 12 }, { key: 'count', label: '건수', num: true, width: 8 }, ...MONEY_COLS, { key: 'missing', label: '금액 미입력', num: true, width: 10 }];
  return { name: `${month} 월매출`, title: `경민물류 월 매출 ${dayjs(from).format('YYYY년 M월')}`, columns, rows, totals: sumRow(rows, { date: '합계' }) };
}

/** 거래처별 매출 (청구처 기준) */
export function clientReport(snap: Snapshot, from: string, to: string): ReportSheet {
  const lines = revenueLines(snap, from, to);
  const m = new Map<string, RevenueLine[]>();
  for (const l of lines) {
    const k = snap.clients.find((c) => c.id === (l.rev?.bill_to_client_id ?? l.order.client_id))?.name ?? (clientName(snap, l.order) || '(거래처 없음)');
    m.set(k, [...(m.get(k) ?? []), l]);
  }
  const rows: ReportRow[] = [...m.entries()].map(([client, ls]) => {
    const priced = ls.filter((l) => l.rev?.total != null);
    const sum = (f: (l: RevenueLine) => number) => priced.reduce((a, l) => a + f(l), 0);
    return {
      client, count: ls.length,
      supply: priced.length ? sum((l) => l.rev!.supply_amount ?? 0) : null, vat: priced.length ? sum((l) => l.rev!.vat ?? 0) : null, total: priced.length ? sum((l) => l.rev!.total ?? 0) : null,
      missing: ls.length - priced.length || null,
      unbilled: sum((l) => (l.rev!.billing_status === '미청구' ? l.rev!.total ?? 0 : 0)) || null,
      unpaid: sum((l) => (l.rev!.billing_status === '청구' ? l.rev!.total ?? 0 : 0)) || null,
    };
  }).sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
  const columns: ReportColumn[] = [
    { key: 'client', label: '거래처', width: 20 }, { key: 'count', label: '건수', num: true, width: 8 }, ...MONEY_COLS,
    { key: 'missing', label: '금액 미입력', num: true, width: 10 }, { key: 'unbilled', label: '미청구 금액', num: true }, { key: 'unpaid', label: '미입금 금액', num: true },
  ];
  return { name: '거래처별 매출', title: `경민물류 거래처별 매출 ${dayLabel(from)} ~ ${dayLabel(to)}`, columns, rows, totals: sumRow(rows, { client: '합계' }) };
}

/** 선박 이용현황: 선박별 합계 + 배편 목록 + 벌크 */
export function shipReport(snap: Snapshot, from: string, to: string): ReportSheet[] {
  const vs = shipCosts(snap, from, to);
  const bs = bulkCosts(snap, from, to);
  const ships = [...new Set([...vs.map((v) => v.ship || '(선박명 없음)'), ...bs.map((b) => b.ship)])];
  const rows: ReportRow[] = ships.map((s) => {
    const mine = vs.filter((v) => (v.ship || '(선박명 없음)') === s);
    const bulk = bs.filter((b) => b.ship === s);
    const vehCost = mine.reduce((a, v) => a + v.total, 0);
    const bulkCost = bulk.reduce((a, b) => a + (b.fee ?? 0), 0);
    return {
      ship: s, count: mine.length, base: mine.filter((v) => v.kind === 'base').length || null, empty: mine.filter((v) => v.kind === 'empty').length || null,
      surcharge: mine.filter((v) => v.kind === 'surcharge').length || null, boarding: mine.filter((v) => v.row.vd?.boarding).length || null,
      vehCost, bulkN: bulk.length || null, bulkCost: bulkCost || null, total: vehCost + bulkCost,
      missing: mine.filter((v) => v.missing.length).length + bulk.filter((b) => b.missing).length || null,
    };
  }).sort((a, b) => Number(b.total) - Number(a.total));
  const sum: ReportRow = { ship: '합계' };
  for (const k of ['count', 'base', 'empty', 'surcharge', 'boarding', 'vehCost', 'bulkN', 'bulkCost', 'total', 'missing']) sum[k] = rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const range = `${dayLabel(from)} ~ ${dayLabel(to)}`;
  return [
    {
      name: '선박별', title: `경민물류 선박 이용현황 ${range}`, rows, totals: sum,
      columns: [
        { key: 'ship', label: '선박', width: 14 }, { key: 'count', label: '차량 건수', num: true, width: 9 }, { key: 'base', label: '기본', num: true, width: 7 },
        { key: 'empty', label: '공차', num: true, width: 7 }, { key: 'surcharge', label: '할증', num: true, width: 7 }, { key: 'boarding', label: '승선', num: true, width: 7 },
        { key: 'vehCost', label: '차량 선박비', num: true }, { key: 'bulkN', label: '벌크 건수', num: true, width: 9 }, { key: 'bulkCost', label: '벌크 선박비', num: true },
        { key: 'total', label: '합계', num: true }, { key: 'missing', label: '요금 미등록', num: true, width: 10 },
      ],
    },
    {
      name: '배편 목록', title: `배편 목록 ${range}`,
      columns: [
        { key: 'date', label: '날짜', width: 10 }, { key: 'ship', label: '선박', width: 14 }, { key: 'veh', label: '차량', width: 8 }, { key: 'what', label: '구분', width: 10 },
        { key: 'driver', label: '기사', width: 10 }, { key: 'boarding', label: '승선', width: 6 }, { key: 'fare', label: '운임', num: true }, { key: 'bfee', label: '승선 금액', num: true },
        { key: 'total', label: '합계', num: true }, { key: 'note', label: '비고', width: 18 },
      ],
      rows: [
        ...vs.map((v) => ({
          date: dayLabel(v.date), ship: v.ship, veh: v.row.vehicle.short_no, what: FARE_KIND_LABEL[v.kind] + (v.manual ? '' : '(자동)'),
          driver: driverName(snap, v.row.loadDriverId ?? v.row.driverId), boarding: v.row.vd?.boarding ? '승선' : '', fare: v.fare, bfee: v.boarding,
          total: v.total, note: v.missing.join(', '),
        })),
        ...bs.map((b) => ({ date: dayLabel(b.date), ship: b.ship, veh: '벌크', what: `${clientName(snap, b.order)} ${productName(snap, b.order)} ${qtyText(b.order)}`, fare: b.fee, total: b.fee, note: b.missing })),
      ],
    },
  ];
}
