// 종이 일정표 모양 (확인용, 누르기 없음): 차량 한 대 = 한 줄. 선박 | 차량 | 기사 | 하차 | 차량 | 기사 | 상차 | 선박 (제주는 오전·오후)
import {
  DAY_STATUS_LABEL, ON_CALL_SHIFT, driverZone, isDriverWorking, isExternal, missingDriver, workText, offByZone, parseShip, seqMark, sitesGrouped,
  type BoardRow, type DailyOrder, type FieldAssignment, type Snapshot, type Zone,
} from '../../domain/index.ts';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useSnap } from '../../ui/hooks.ts';
import { clientName, driverName, productName, qtyText, shipTimeOf, vehicleNo } from '../../ui/labels.ts';

const ZONE_NAME: Record<Zone, string> = { land: '육지', jeju: '제주' };
const HEAD: Record<Zone, string[]> = {
  land: ['선박', '차량', '기사', '하차', '차량', '기사', '상차', '선박'],
  jeju: ['선박', '차량', '이름', '오전', '차량', '이름', '오후', '선박'],
};

function Cols() {
  return (
    <colgroup>
      <col className="c-ship" /><col className="c-veh" /><col className="c-drv" /><col className="c-body" />
      <col className="c-veh" /><col className="c-drv" /><col className="c-body" /><col className="c-ship" />
    </colgroup>
  );
}

/** 칸 안에서 줄을 바꾸지 않고, 길면 글자를 줄여 한 줄에 맞춘다 (최소 6px, 그래도 길면 옆으로 눌러서) */
function Fit({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const cell = el?.parentElement;
    if (!el || !cell) return;
    const fit = () => {
      el.style.fontSize = '';
      el.style.transform = '';
      const cs = getComputedStyle(cell);
      const avail = cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const need = el.scrollWidth;
      if (avail > 0 && need > avail) {
        const base = parseFloat(getComputedStyle(el).fontSize);
        el.style.fontSize = `${Math.max(6, Math.floor((base * avail / need) * 10) / 10)}px`;
        // 최소 크기에서도 넘치면 옆으로 살짝 눌러서 맞춘다
        const still = el.scrollWidth;
        if (still > avail) el.style.transform = `scaleX(${(avail / still).toFixed(3)})`;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cell);
    return () => ro.disconnect();
  });
  return <span ref={ref} className="fit">{children}</span>;
}

/** 선박 칸: (예약업체·표시 작게 한 줄) / 선박명 / 시간(작게). 지역(기항지)은 표시하지 않음 */
function ShipText({ snap, ship, tag }: { snap: Snapshot; ship: string | null; tag: string }) {
  if (!ship) return null;
  const time = shipTimeOf(snap, ship);
  return (
    <div className="ps-ship">
      {tag && <div className="ps-line"><Fit><span className="ps-tag">{tag}</span></Fit></div>}
      <div className="ps-line"><Fit><span className="ps-name">{parseShip(ship).name}</span></Fit></div>
      {time && <div className="ps-time">{time}</div>}
    </div>
  );
}

/** 오더 칸: 거래처별로 묶어 "업체 품목 수량, 품목 수량". 바로 위에 상차지(하차는 하차지)·비고·품목 주의사항을 빨간 작은 글씨로 */
function Orders({ snap, list }: { snap: Snapshot; list: DailyOrder[] }) {
  const groups: DailyOrder[][] = [];
  for (const o of list) {
    const last = groups[groups.length - 1];
    if (last && clientName(snap, last[0]) === clientName(snap, o)) last.push(o);
    else groups.push([o]);
  }
  return (
    <>
      {groups.map((g) => {
        const notes = [...new Set(g.flatMap((o) => {
          const product = snap.products.find((x) => x.id === o.product_id);
          return [
            workText(o),
            o.kind === 'load' ? o.pickup_place : o.dropoff_place,
            o.kind === 'load' && o.shipment === 'bulk' ? '벌크' : '',
            o.memo,
            product?.caution?.split('\n')[0],
          ].map((x) => x?.trim() ?? '');
        }).filter(Boolean))];
        const items = g.map((o) => [productName(snap, o), qtyText(o)].filter(Boolean).join(' ')).filter(Boolean);
        return (
          <div key={g[0].id} className="ps-ord">
            {notes.length > 0 && <div className="ps-oline"><Fit><span className="ps-note">{notes.join(' · ')}</span></Fit></div>}
            <div className="ps-oline"><Fit>{[clientName(snap, g[0]), items.join(', ')].filter(Boolean).join(' ') || '·'}</Fit></div>
          </div>
        );
      })}
    </>
  );
}

function VehicleRow({ snap, row }: { snap: Snapshot; row: BoardRow }) {
  const status = row.status && row.status !== 'field' ? row.status : '';
  const helper = row.helperId ? <div className="ps-oline center"><Fit><span className="ps-helper">+{driverName(snap, row.helperId)} {row.helperRole}</span></Fit></div> : null;
  const start = row.startTime || row.startPlace
    ? <div className="ps-oline center"><Fit><span className="ps-start">{[row.startTime, row.startPlace].filter(Boolean).join(' ')}</span></Fit></div>
    : null;
  const noUnload = missingDriver(row, 'unload');
  const noLoad = missingDriver(row, 'load');
  const MISSING = <div className="ps-oline center"><Fit><span className="ps-nodrv">미배치</span></Fit></div>;
  const name = <>{start}{noUnload ? MISSING : <div className="ps-oline center"><Fit>{driverName(snap, row.driverId)}{seqMark(row.unloadSeq)}</Fit></div>}{helper}</>;
  const loadName = <>{noLoad ? MISSING : <div className="ps-oline center"><Fit>{driverName(snap, row.loadDriverId)}{seqMark(row.loadSeq)}</Fit></div>}{helper}</>;
  const statusText = status || row.statusMemo
    ? <>{status && <span className={`st ${status}`}>{DAY_STATUS_LABEL[status]}</span>}{row.statusMemo && <span className="ps-red"> {row.statusMemo}</span>}</>
    : null;
  const veh = <td className="veh"><Fit><span className={`ps-pill veh ${row.inRepair ? 'repair' : ''}`}>{row.vehicle.short_no}</span></Fit></td>;
  return (
    <tr className={row.secondary ? 'secondary' : ''}>
      <td className="ship"><ShipText snap={snap} ship={row.arrivalShip} tag={row.arrivalTag} /></td>
      {veh}
      <td className={`drv${noUnload ? ' nodrv' : ''}`}>{name}</td>
      <td className="body">{row.unloads.length ? <Orders snap={snap} list={row.unloads} /> : <Fit>{statusText}</Fit>}</td>
      {veh}
      <td className={`drv${noLoad ? ' nodrv' : ''}`}>{loadName}</td>
      <td className="body">{row.loads.length ? <Orders snap={snap} list={row.loads} /> : row.unloads.length ? <Fit>{statusText}</Fit> : null}</td>
      <td className="ship"><ShipText snap={snap} ship={row.departureShip} tag={row.departureTag} /></td>
    </tr>
  );
}

/** 배차 대기(노란 칸) · 용차·화주배차(빨간 글씨) 줄 */
function WaitingRow({ snap, o }: { snap: Snapshot; o: DailyOrder }) {
  const ext = isExternal(o);
  const load = o.kind === 'load';
  const veh = ext
    ? <td className="veh"><div className="ps-oline center"><Fit><span className="ps-ext">{o.carrier_name || (o.carrier_type === 'shipper' ? '화주' : '용차')}</span></Fit></div></td>
    : <td className="veh wait"><Fit>미배차</Fit></td>;
  return (
    <tr className={ext ? 'external' : 'waiting'}>
      <td className="ship">{!load && <ShipText snap={snap} ship={o.arrival_ship} tag={o.arrival_ship_tag} />}</td>
      {load ? <td className="veh" /> : veh}
      <td className="drv" />
      <td className="body">{!load && <Orders snap={snap} list={[o]} />}</td>
      {load ? veh : <td className="veh" />}
      <td className="drv" />
      <td className="body">{load && <Orders snap={snap} list={[o]} />}</td>
      <td className="ship">{load && <ShipText snap={snap} ship={o.departure_ship} tag={o.departure_ship_tag} />}</td>
    </tr>
  );
}

export function SheetBoard(p: { zone: Zone; date: string; rows: BoardRow[]; waiting: DailyOrder[]; external: DailyOrder[]; field: FieldAssignment[] }) {
  const snap = useSnap();

  // 비지정 근무자(자유롭게 일함)는 근무·대기·휴무 명단에서 뺀다 (배차된 차량 줄에는 그대로 나옴)
  const off = offByZone(snap, p.date)[p.zone].filter((d) => !d.unlisted);
  // 근무자: 이 표 차량에 배차된 기사(오전·오후·동승) + 이 지역 근무일인데 아직 차량 없는 기사(대기)
  const offIds = new Set(off.map((d) => d.id));
  const assignedIds = new Set(p.rows.flatMap((r) => [r.driverId, r.loadDriverId, r.helperId]).filter((x): x is string => !!x));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ko');
  const working = snap.drivers.filter((d) => assignedIds.has(d.id) && !d.unlisted).sort(byName);
  const busyElsewhere = new Set(snap.vehicle_days.filter((v) => v.date === p.date).flatMap((v) => [v.driver_id, v.load_driver_id, v.helper_driver_id]));
  const standby = snap.drivers
    .filter((d) => d.staff_type === '기사' && d.shift !== ON_CALL_SHIFT && !d.unlisted && driverZone(d) === p.zone && !offIds.has(d.id) && !assignedIds.has(d.id) && !busyElsewhere.has(d.id) && isDriverWorking(snap, d, p.date))
    .sort(byName);
  return (
    <table className={`paper ${p.zone}`}>
      <Cols />
      <thead>
        <tr><th colSpan={8} className="zone">{ZONE_NAME[p.zone]}</th></tr>
        <tr>{HEAD[p.zone].map((h, i) => <th key={i}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {p.rows.map((r) => <VehicleRow key={r.vehicle.id + (r.secondary ? '-2' : '')} snap={snap} row={r} />)}
        {p.waiting.map((o) => <WaitingRow key={o.id} snap={snap} o={o} />)}
        {p.external.map((o) => <WaitingRow key={o.id} snap={snap} o={o} />)}

        {(working.length > 0 || standby.length > 0) && (
          <tr className="fieldrow workrow first">
            <td className="site"><Fit>기사 근무</Fit></td>
            <td className="body" colSpan={7}><Fit>{working.map((d) => d.name).join(', ')}{standby.length ? <span className="ps-standby">{working.length ? '  ·  ' : ''}대기: {standby.map((d) => d.name).join(', ')}</span> : null}</Fit></td>
          </tr>
        )}
        {off.some((d) => d.staff_type === '기사') && (
          <tr className={`fieldrow offrow${working.length || standby.length ? '' : ' first'}`}>
            <td className="site"><Fit>기사 휴무</Fit></td>
            <td className="body" colSpan={7}><Fit>{off.filter((d) => d.staff_type === '기사').map((d) => d.name).join(', ')}</Fit></td>
          </tr>
        )}

      </tbody>
    </table>
  );
}

/** 현장 표 (육지·제주와 따로, 근무자가 없어도 표시): 근무지 | 차량 | 이름 | 업무, 맨 밑에 현장 휴무 */
export function SheetExtras({ date, field }: { date: string; field: FieldAssignment[] }) {
  const snap = useSnap();
  const rows = sitesGrouped(snap, field).groups.flatMap((g) => g.rows);
  const offAll = offByZone(snap, date);
  const fieldOff = [...offAll.jeju, ...offAll.land].filter((d) => d.staff_type !== '기사' && !d.unlisted).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const siteName = (f: FieldAssignment) => snap.field_sites.find((x) => x.id === f.site_id)?.name ?? '근무지 미정';
  return (
    <table className="paper fieldwork">
      <colgroup><col style={{ width: '20%' }} /><col style={{ width: '13%' }} /><col style={{ width: '15%' }} /><col /></colgroup>
      <thead>
        <tr><th colSpan={4} className="zone">현장</th></tr>
        <tr><th>근무지</th><th>차량</th><th>이름</th><th>업무</th></tr>
      </thead>
      <tbody>
        {rows.map((f, i) => (
          <tr key={f.id} className={i > 0 && siteName(rows[i - 1]) !== siteName(f) ? 'newsite' : ''}>
            <td className="site"><Fit>{i === 0 || siteName(rows[i - 1]) !== siteName(f) ? siteName(f) : ''}</Fit></td>
            <td className="veh">{f.vehicle_id && <Fit><span className="ps-pill veh">{vehicleNo(snap, f.vehicle_id)}</span></Fit>}</td>
            <td className="drv"><Fit>{driverName(snap, f.staff_id)}</Fit></td>
            <td className="body"><Fit>{f.task}</Fit></td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={4} className="body" style={{ color: '#888', textAlign: 'center' }}>근무자 없음</td></tr>}
        <tr className="fieldrow offrow first">
          <td className="site"><Fit>현장 휴무</Fit></td>
          <td className="body" colSpan={3}><Fit>{fieldOff.map((d) => d.name).join(', ') || '없음'}</Fit></td>
        </tr>
      </tbody>
    </table>
  );
}
