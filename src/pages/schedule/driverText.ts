// 기사 한 사람의 그날 일정을 카톡 문자로 (그림 없이): 도착 선박 · 차량 · 출근 · 오전(하차)/오후(상차) · 야간 · 마감 선박
import {
  FIELD_PART_LABEL, HELPER_ROLE_LABEL, isWaitShip, parseShip, pmArrival, shownMemo, workText, type Board, type BoardRow, type DailyOrder, type Snapshot, type Zone,
} from '../../domain/index.ts';
import { dayjs } from '../../lib/time.ts';
import { ZONE_LABEL, clientName, driverName, productName, productOf, qtyText, shipTimeOf, vehicleNo } from '../../ui/labels.ts';
import { regionOf } from './parts.tsx';

/** 그날 일이 있는 사람 (배차 기사 · 야간 · 동승 · 현장근무), 이름순 */
export function peopleOn(snap: Snapshot, board: Board): { id: string; name: string; what: string }[] {
  const what = new Map<string, Set<string>>();
  const add = (id: string | null, w: string) => { if (id) what.set(id, (what.get(id) ?? new Set()).add(w)); };
  for (const r of board.rows) {
    add(r.driverId, r.vehicle.short_no);
    add(r.loadDriverId, r.vehicle.short_no);
    add(r.nightDriverId, `${r.vehicle.short_no} 야간`);
    add(r.helperId, `${r.vehicle.short_no} 동승`);
  }
  for (const f of board.field) if (!f.is_off) add(f.staff_id, '현장');
  return [...what.entries()]
    .map(([id, w]) => ({ id, name: driverName(snap, id), what: [...w].join(' · ') }))
    .filter((x) => x.name)
    // 배차 기사 먼저, 현장근무만 있는 사람은 뒤에
    .sort((a, b) => Number(a.what === '현장') - Number(b.what === '현장') || a.name.localeCompare(b.name, 'ko'));
}

function orderLine(snap: Snapshot, o: DailyOrder, i: number): string[] {
  const region = regionOf(snap, o);
  const st = productOf(snap, o)?.storage;
  const cold = st === 'frozen' ? ' (냉동)' : st === 'chilled' ? ' (냉장)' : '';
  const lines = [`${i + 1}. ${[clientName(snap, o), region && `[${region}]`, `${productName(snap, o)}${cold}`, qtyText(o)].filter(Boolean).join(' ')}`];
  const place = o.kind === 'load' ? o.pickup_place : o.dropoff_place;
  const memo = shownMemo(snap, o)?.trim();
  // 시간 · 상차지/하차지 · 비고 · 벌크는 있을 때만 바로 밑에 한 줄씩
  for (const x of [workText(o), place && `${o.kind === 'load' ? '상차지' : '하차지'} ${place}`, memo, o.kind === 'load' && o.shipment === 'bulk' ? '벌크(화물만 선적)' : '']) {
    if (x) lines.push(`   ${x}`);
  }
  return lines;
}

/** 도착 선박: "제이엘오션(목포출항)" (시간 없이) */
function arrivalText(value: string | null, tag: string, zone: Zone): string {
  if (!value || isWaitShip(value)) return '';
  const { name, port } = parseShip(value);
  const from = port || (zone === 'land' ? '제주' : '');
  return `${tag ? `${tag} ` : ''}${name}${from ? `(${from}출항)` : ''}`;
}

/** 마감(출발) 선박: "제이엘오션(제주출발) 16시10분" */
function departureText(snap: Snapshot, value: string | null, tag: string, zone: Zone): string {
  if (!value || isWaitShip(value)) return '';
  const { name, port } = parseShip(value);
  const time = shipTimeOf(snap, value);
  const hm = /^(\d{1,2}):(\d{2})$/.exec(time);
  return `${tag ? `${tag} ` : ''}${name}(${port || (zone === 'jeju' ? '제주' : '육지')}출발)${hm ? ` ${Number(hm[1])}시${hm[2]}분` : time ? ` ${time}` : ''}`;
}

function rowText(snap: Snapshot, r: BoardRow, me: string): string[] {
  const z = r.zone ?? 'land';
  const helper = r.helperId === me;
  const unload = helper || r.driverId === me || (pmArrival(r) && r.loadDriverId === me);
  const load = helper || r.loadDriverId === me;
  const night = r.nightDriverId === me && r.nights.length > 0;
  const out: string[] = [];
  const arr = unload ? arrivalText(r.arrivalShip, r.arrivalTag, z) : '';
  if (arr) out.push(`도착 ${arr}`);
  out.push(`${r.vehicle.short_no}${r.vehicle.plate && r.vehicle.plate !== r.vehicle.short_no ? ` (${r.vehicle.plate})` : ''} · ${ZONE_LABEL[z]}`);
  if (helper) out.push(`${r.helperRole ? HELPER_ROLE_LABEL[r.helperRole] : '동승'} (기사 ${driverName(snap, r.driverId) || '미정'})`);
  if ((unload || load) && (r.startTime || r.startPlace)) out.push(`출근 ${[r.startTime, r.startPlace].filter(Boolean).join(' ')}`);
  if (unload && r.unloads.length) {
    out.push('', `■ ${z === 'jeju' ? (pmArrival(r) ? '오후 하차' : '오전') : '하차'} 일정`);
    r.unloads.forEach((o, i) => out.push(...orderLine(snap, o, i)));
  }
  if (load && (r.loads.length || r.carried.length)) {
    out.push('', `■ ${z === 'jeju' ? '오후' : '상차'} 일정`);
    r.carried.forEach((o) => out.push(`[[ ${[clientName(snap, o), productName(snap, o), qtyText(o)].filter(Boolean).join(' ')} ]]`));
    r.loads.forEach((o, i) => out.push(...orderLine(snap, o, i)));
  }
  if (night) {
    out.push('', '■ 야간 일정');
    r.nights.forEach((o, i) => {
      const [first, ...rest] = orderLine(snap, o, i);
      out.push(`${first} (${o.kind === 'load' ? '상차' : '하차'}${o.zone !== z ? ` · ${ZONE_LABEL[o.zone]}` : ''})`, ...rest);
    });
  }
  if (r.status && r.status !== 'field' && !r.unloads.length && !r.loads.length && r.statusMemo) out.push('', r.statusMemo);
  // 마감 선박은 맨 밑에 출발 시간과 함께 (야간 상차 뒤 배는 그 배)
  const nightDep = night ? r.nights.find((o) => o.kind === 'load' && o.departure_ship && !isWaitShip(o.departure_ship)) : undefined;
  const dep = load && r.departureShip ? departureText(snap, r.departureShip, r.departureTag, z)
    : nightDep ? departureText(snap, nightDep.departure_ship, nightDep.departure_ship_tag, nightDep.zone) : '';
  if (dep) out.push('', dep);
  return out;
}

/** 카톡으로 보낼 문자 */
export function driverDayText(snap: Snapshot, board: Board, date: string, me: string): string {
  const blocks: string[][] = [];
  const mine = board.rows
    .filter((r) => r.driverId === me || r.loadDriverId === me || r.helperId === me || (r.nightDriverId === me && r.nights.length > 0))
    .sort((a, b) => (Math.min(a.unloadSeq ?? 99, a.loadSeq ?? 99) - Math.min(b.unloadSeq ?? 99, b.loadSeq ?? 99)));
  for (const r of mine) blocks.push(rowText(snap, r, me));
  // 야간 기사만 정하고 야간 작업이 아직 없는 차량
  for (const r of board.rows.filter((x) => x.nightDriverId === me && !x.nights.length && !mine.includes(x))) blocks.push([`${r.vehicle.short_no} · 야간 (작업 미정)`]);
  for (const f of board.field.filter((x) => x.staff_id === me && !x.is_off)) {
    const site = snap.field_sites.find((s) => s.id === f.site_id)?.name ?? '근무지 미정';
    blocks.push([`현장근무 · ${site}${f.part ? ` (${FIELD_PART_LABEL[f.part]})` : ''}`, ...(f.task ? [f.task] : []), ...(f.vehicle_id ? [`지급 차량 ${vehicleNo(snap, f.vehicle_id)}`] : [])]);
  }
  if (!blocks.length) blocks.push(['배차 없음']);
  return [`${dayjs(date).format('M/D(dd)')} ${driverName(snap, me)}`, '', blocks.map((b) => b.join('\n')).join('\n\n')].join('\n');
}
