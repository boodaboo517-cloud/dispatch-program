// 기사 한 사람의 그날 일정을 카톡 문자로: 차량 · 출근 · 오전(하차)/오후(상차) · 야간 · 동승 · 현장근무
import {
  FIELD_PART_LABEL, HELPER_ROLE_LABEL, pmArrival, shownMemo, workText, type Board, type BoardRow, type DailyOrder, type Snapshot,
} from '../../domain/index.ts';
import { dayjs } from '../../lib/time.ts';
import { ZONE_LABEL, clientName, driverName, productName, productOf, qtyText, shipText, shipTimeOf, vehicleNo } from '../../ui/labels.ts';
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
  if (workText(o)) lines.push(`   ⏰ ${workText(o)}`);
  if (place) lines.push(`   📍 ${o.kind === 'load' ? '상차지' : '하차지'} ${place}`);
  const memo = shownMemo(snap, o)?.trim();
  if (memo) lines.push(`   📝 ${memo}`);
  if (o.kind === 'load' && o.shipment === 'bulk') lines.push('   📦 벌크 (화물만 선적)');
  return lines;
}

const ship = (snap: Snapshot, s: string | null, tag: string) => (s ? `${shipText(s, tag as never)}${shipTimeOf(snap, s) ? ` ${shipTimeOf(snap, s)}` : ''}` : '');

function rowText(snap: Snapshot, r: BoardRow, me: string): string[] {
  const z = r.zone ?? 'land';
  const helper = r.helperId === me;
  const unload = helper || r.driverId === me || (pmArrival(r) && r.loadDriverId === me);
  const load = helper || r.loadDriverId === me;
  const night = r.nightDriverId === me && r.nights.length > 0;
  const out: string[] = [];
  out.push(`🚚 ${r.vehicle.short_no}${r.vehicle.plate && r.vehicle.plate !== r.vehicle.short_no ? ` (${r.vehicle.plate})` : ''} · ${ZONE_LABEL[z]}`);
  if (helper) out.push(`👥 ${r.helperRole ? HELPER_ROLE_LABEL[r.helperRole] : '동승'} (기사 ${driverName(snap, r.driverId) || '미정'})`);
  if ((unload || load) && (r.startTime || r.startPlace)) out.push(`🕖 출근 ${[r.startTime, r.startPlace].filter(Boolean).join(' ')}`);
  if (unload && (r.unloads.length || r.arrivalShip)) {
    const arr = ship(snap, r.arrivalShip, r.arrivalTag);
    out.push(`■ ${z === 'jeju' ? (pmArrival(r) ? '오후 하차' : '오전') : '하차'}${arr ? ` (${z === 'jeju' ? '도착' : '상행'} ${arr})` : ''}`);
    if (r.unloads.length) r.unloads.forEach((o, i) => out.push(...orderLine(snap, o, i)));
    else out.push('   없음');
  }
  if (load && (r.loads.length || r.carried.length || r.departureShip)) {
    const dep = ship(snap, r.departureShip, r.departureTag);
    out.push(`■ ${z === 'jeju' ? '오후' : '상차'}${dep ? ` (${z === 'jeju' ? '출발' : '하행'} ${dep})` : ''}`);
    r.carried.forEach((o) => out.push(`   [[ 싣고 있는 짐: ${clientName(snap, o)} ${productName(snap, o)} ${qtyText(o)} ]]`));
    r.loads.forEach((o, i) => out.push(...orderLine(snap, o, i)));
    if (!r.loads.length && !r.carried.length) out.push('   없음');
  }
  if (night) {
    out.push('■ 야간');
    r.nights.forEach((o, i) => {
      const [first, ...rest] = orderLine(snap, o, i);
      const dep = o.kind === 'load' && o.departure_ship ? ` → ${ship(snap, o.departure_ship, o.departure_ship_tag)}` : '';
      out.push(`${first} (${o.kind === 'load' ? '상차' : '하차'}${o.zone !== z ? ` · ${ZONE_LABEL[o.zone]}` : ''})${dep}`, ...rest);
    });
  }
  if (r.status && r.status !== 'field' && !r.unloads.length && !r.loads.length && r.statusMemo) out.push(`※ ${r.statusMemo}`);
  return out;
}

/** 카톡으로 보낼 문자 */
export function driverDayText(snap: Snapshot, board: Board, date: string, me: string): string {
  const name = driverName(snap, me);
  const head = `[경민물류] ${dayjs(date).format('M/D(dd)')} ${name} 기사님 일정`;
  const blocks: string[][] = [];
  const mine = board.rows
    .filter((r) => r.driverId === me || r.loadDriverId === me || r.helperId === me || (r.nightDriverId === me && r.nights.length > 0))
    .sort((a, b) => (Math.min(a.unloadSeq ?? 99, a.loadSeq ?? 99) - Math.min(b.unloadSeq ?? 99, b.loadSeq ?? 99)));
  for (const r of mine) blocks.push(rowText(snap, r, me));
  // 야간 기사만 정하고 야간 작업이 아직 없는 차량
  for (const r of board.rows.filter((x) => x.nightDriverId === me && !x.nights.length && !mine.includes(x))) blocks.push([`🚚 ${r.vehicle.short_no} · 야간 (작업 미정)`]);
  for (const f of board.field.filter((x) => x.staff_id === me && !x.is_off)) {
    const site = snap.field_sites.find((s) => s.id === f.site_id)?.name ?? '근무지 미정';
    blocks.push([`🏭 현장근무 · ${site}${f.part ? ` (${FIELD_PART_LABEL[f.part]})` : ''}`, ...(f.task ? [`   ${f.task}`] : []), ...(f.vehicle_id ? [`   지급 차량 ${vehicleNo(snap, f.vehicle_id)}`] : [])]);
  }
  if (!blocks.length) blocks.push(['배차 없음']);
  return [head, '', ...blocks.map((b) => b.join('\n')).join('\n\n').split('\n'), '', '안전운행 하세요 🙏'].join('\n');
}
