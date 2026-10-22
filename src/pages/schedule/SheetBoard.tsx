// 종이 일정표 모양 (확인용, 누르기 없음): 차량 한 대 = 한 줄. 선박 | 차량 | 기사 | 하차 | 차량 | 기사 | 상차 | 선박 (제주는 오전·오후)
import {
  DAY_STATUS_LABEL, isExternal, parseShip, sitesGrouped,
  type BoardRow, type DailyOrder, type FieldAssignment, type Snapshot, type Zone,
} from '../../domain/index.ts';
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

function ShipText({ snap, ship, tag }: { snap: Snapshot; ship: string | null; tag: string }) {
  if (!ship) return null;
  const { name, port } = parseShip(ship);
  return (
    <>
      {tag && <span className="ps-tag">{tag}</span>}
      <span className="ps-pill">{name}{port && <small> {port}</small>}</span>
      <span className="ps-time">{shipTimeOf(snap, ship)}</span>
    </>
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
  const name = driverName(snap, row.driverId);
  const statusText = status || row.statusMemo
    ? <>{status && <span className={`st ${status}`}>{DAY_STATUS_LABEL[status]}</span>}{row.statusMemo && <span className="ps-red"> {row.statusMemo}</span>}</>
    : null;
  const veh = <td className="veh"><span className={`ps-pill veh ${row.inRepair ? 'repair' : ''}`}>{row.vehicle.short_no}</span></td>;
  return (
    <tr className={row.secondary ? 'secondary' : ''}>
      <td className="ship"><ShipText snap={snap} ship={row.arrivalShip} tag={row.arrivalTag} /></td>
      {veh}
      <td className="drv">{name}</td>
      <td className="body">{row.unloads.length ? <Orders snap={snap} list={row.unloads} /> : statusText}</td>
      {veh}
      <td className="drv">{name}</td>
      <td className="body">{row.loads.length ? <Orders snap={snap} list={row.loads} /> : row.unloads.length ? statusText : null}</td>
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
    : <td className="veh wait">미배차</td>;
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

/** 현장근무 줄: 근무지 | 차량 | 이름 | 업무 | · | · | · | · */
function FieldRows({ snap, rows }: { snap: Snapshot; rows: FieldAssignment[] }) {
  const siteName = (f: FieldAssignment) => snap.field_sites.find((s) => s.id === f.site_id)?.name ?? '근무지 미정';
  return (
    <>
      {rows.map((f, i) => (
        <tr key={f.id} className={`fieldrow ${i === 0 ? 'first' : ''}`}>
          <td className="site">{i === 0 || siteName(rows[i - 1]) !== siteName(f) ? siteName(f) : ''}</td>
          <td className="veh">{f.vehicle_id && <span className="ps-pill veh">{vehicleNo(snap, f.vehicle_id)}</span>}</td>
          <td className="drv">{driverName(snap, f.staff_id)}</td>
          <td className="body">{f.task}</td>
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
export function SheetExtras({ field }: { field: FieldAssignment[] }) {
  const snap = useSnap();
  const { groups, off } = sitesGrouped(snap, field);
  const rest = groups.filter((g) => !g.site.zone).flatMap((g) => g.rows);
  const offNames = off.map((f) => driverName(snap, f.staff_id)).filter(Boolean);
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
