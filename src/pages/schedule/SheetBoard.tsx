// 종이 일정표 모양 (확인용, 누르기 없음): 차량 한 대 = 한 줄. 선박 | 차량 | 기사 | 하차 | 차량 | 기사 | 상차 | 선박 (제주는 오전·오후)
import {
  DAY_STATUS_LABEL, isExternal, parseShip, seqMark, sitesGrouped, weeklyOffOn,
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

function Orders({ snap, list }: { snap: Snapshot; list: DailyOrder[] }) {
  return (
    <>
      {list.map((o, i) => (
        <span key={o.id}>
          {i > 0 && <span className="ps-sep"> / </span>}
          {[clientName(snap, o), productName(snap, o), qtyText(o)].filter(Boolean).join(' ')}
          {o.kind === 'load' && o.shipment === 'bulk' && <span className="ps-red"> 벌크</span>}
          {o.memo && <span className="ps-red"> {o.memo}</span>}
        </span>
      ))}
    </>
  );
}

function VehicleRow({ snap, row }: { snap: Snapshot; row: BoardRow }) {
  const status = row.status && row.status !== 'field' ? row.status : '';
  const name = `${driverName(snap, row.driverId)}${seqMark(row.unloadSeq)}`;
  const loadName = `${driverName(snap, row.loadDriverId)}${seqMark(row.loadSeq)}`;
  const statusText = status || row.statusMemo
    ? <>{status && <span className={`st ${status}`}>{DAY_STATUS_LABEL[status]}</span>}{row.statusMemo && <span className="ps-red"> {row.statusMemo}</span>}</>
    : null;
  const veh = <td className="veh"><Fit><span className={`ps-pill veh ${row.inRepair ? 'repair' : ''}`}>{row.vehicle.short_no}</span></Fit></td>;
  return (
    <tr className={row.secondary ? 'secondary' : ''}>
      <td className="ship"><ShipText snap={snap} ship={row.arrivalShip} tag={row.arrivalTag} /></td>
      {veh}
      <td className="drv"><Fit>{name}</Fit></td>
      <td className="body"><Fit>{row.unloads.length ? <Orders snap={snap} list={row.unloads} /> : statusText}</Fit></td>
      {veh}
      <td className="drv"><Fit>{loadName}</Fit></td>
      <td className="body"><Fit>{row.loads.length ? <Orders snap={snap} list={row.loads} /> : row.unloads.length ? statusText : null}</Fit></td>
      <td className="ship"><ShipText snap={snap} ship={row.departureShip} tag={row.departureTag} /></td>
    </tr>
  );
}

/** 배차 대기(노란 칸) · 용차·화주배차(빨간 글씨) 줄 */
function WaitingRow({ snap, o }: { snap: Snapshot; o: DailyOrder }) {
  const ext = isExternal(o);
  const load = o.kind === 'load';
  const veh = ext
    ? <td className="veh"><span className="ps-ext">{o.carrier_name || (o.carrier_type === 'shipper' ? '화주' : '용차')}</span></td>
    : <td className="veh wait"><Fit>미배차</Fit></td>;
  return (
    <tr className={ext ? 'external' : 'waiting'}>
      <td className="ship">{!load && <ShipText snap={snap} ship={o.arrival_ship} tag={o.arrival_ship_tag} />}</td>
      {load ? <td className="veh" /> : veh}
      <td className="drv" />
      <td className="body">{!load && <Fit><Orders snap={snap} list={[o]} /></Fit>}</td>
      {load ? veh : <td className="veh" />}
      <td className="drv" />
      <td className="body">{load && <Fit><Orders snap={snap} list={[o]} /></Fit>}</td>
      <td className="ship">{load && <ShipText snap={snap} ship={o.departure_ship} tag={o.departure_ship_tag} />}</td>
    </tr>
  );
}

/** 현장근무 줄: 근무지 | 차량 | 이름 | 업무 | · | · | · | · */
function FieldRows({ snap, rows }: { snap: Snapshot; rows: FieldAssignment[] }) {
  const siteName = (f: FieldAssignment) => snap.field_sites.find((s) => s.id === f.site_id)?.name ?? '근무지 미정';
  return (
    <>
      {rows.map((f, i) => (
        <tr key={f.id} className={`fieldrow ${i === 0 ? 'first' : ''}`}>
          <td className="site"><Fit>{i === 0 || siteName(rows[i - 1]) !== siteName(f) ? siteName(f) : ''}</Fit></td>
          <td className="veh">{f.vehicle_id && <Fit><span className="ps-pill veh">{vehicleNo(snap, f.vehicle_id)}</span></Fit>}</td>
          <td className="drv"><Fit>{driverName(snap, f.staff_id)}</Fit></td>
          <td className="body"><Fit>{f.task}</Fit></td>
          <td className="veh" /><td className="drv" /><td className="body" /><td className="ship" />
        </tr>
      ))}
    </>
  );
}

export function SheetBoard(p: { zone: Zone; rows: BoardRow[]; waiting: DailyOrder[]; external: DailyOrder[]; field: FieldAssignment[] }) {
  const snap = useSnap();
  const fieldRows = sitesGrouped(snap, p.field).groups.filter((g) => g.site.zone === p.zone).flatMap((g) => g.rows);
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
        <FieldRows snap={snap} rows={fieldRows} />
      </tbody>
    </table>
  );
}

/** 육지·제주 어느 표에도 속하지 않은 근무지와 휴무자 */
export function SheetExtras({ date, field }: { date: string; field: FieldAssignment[] }) {
  const snap = useSnap();
  const { groups, off } = sitesGrouped(snap, field);
  const rest = groups.filter((g) => !g.site.zone).flatMap((g) => g.rows);
  // 그날 휴무 지정 + 매주 고정 휴무
  const offNames = [...new Set([...off.map((f) => driverName(snap, f.staff_id)), ...weeklyOffOn(snap, date).map((d) => d.name)])].filter(Boolean);
  if (!rest.length && !offNames.length) return null;
  return (
    <table className="paper extra">
      <Cols />
      <tbody>
        <FieldRows snap={snap} rows={rest} />
        {offNames.length > 0 && (
          <tr className="fieldrow first">
            <td className="site">휴무</td>
            <td className="body" colSpan={7}>{offNames.join(', ')}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
