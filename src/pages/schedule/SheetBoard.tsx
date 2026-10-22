// 종이 일정표 모양: 차량 한 대 = 한 줄. 육지 | 하차 | 기사 | 차량 | 상차 | 기사 | 선박 (제주는 오전·오후)
// 칸을 누르면 배차 화면과 똑같이 보기, 길게 누르면 수정, 빈칸을 누르면 입력.
import type { ReactNode } from 'react';
import {
  DAY_STATUS_LABEL, WORK_TYPE_SHORT, blankField, isExternal, parseShip, saveFieldAssignment, sitesGrouped, workLogOf,
  type BoardRow, type DailyOrder, type FieldAssignment, type Kind, type Snapshot, type Zone,
} from '../../domain/index.ts';
import { store } from '../../data/store.ts';
import { usePress, useRole, useSnap } from '../../ui/hooks.ts';
import { clientName, driverName, productName, qtyText, shipTimeOf, vehicleNo } from '../../ui/labels.ts';
import { usePickers } from '../../ui/pickers.tsx';
import type { useBoardActions } from '../../ui/useBoardActions.tsx';

type Actions = ReturnType<typeof useBoardActions>;

const HEAD: Record<Zone, string[]> = {
  land: ['육지', '하차', '기사', '차량', '상차', '기사', '선박'],
  jeju: ['제주', '오전', '이름', '차량', '오후', '이름', '선박'],
};

function Tap(p: { className?: string; onTap: () => void; onLong?: () => void; children?: ReactNode; title?: string }) {
  const h = usePress(p.onTap, p.onLong);
  return <span role="button" className={`tap ${p.className ?? ''}`} title={p.title} {...h}>{p.children}</span>;
}

/** 한 칸 전체를 누를 수 있게 (빈칸 입력용) */
function TapCell(p: { className?: string; onTap?: () => void; onLong?: () => void; children?: ReactNode }) {
  const h = usePress(p.onTap ?? (() => {}), p.onLong);
  return <td className={`${p.className ?? ''}${p.onTap ? ' click' : ''}`} {...(p.onTap ? h : {})}>{p.children}</td>;
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

function orderLine(snap: Snapshot, o: DailyOrder) {
  return [clientName(snap, o), productName(snap, o), qtyText(o)].filter(Boolean).join(' ');
}

function Orders({ list, a, staff }: { list: DailyOrder[]; a: Actions; staff: boolean }) {
  const snap = useSnap();
  return (
    <>
      {list.map((o, i) => (
        <span key={o.id}>
          {i > 0 && <span className="ps-sep"> / </span>}
          <Tap onTap={() => a.openOrder(o)} onLong={staff ? () => a.openOrder(o, true) : undefined}>
            {orderLine(snap, o) || '·'}
            {o.kind === 'load' && o.shipment === 'bulk' && <span className="ps-red"> (벌크)</span>}
            {o.memo && <span className="ps-red"> {o.memo}</span>}
          </Tap>
        </span>
      ))}
    </>
  );
}

function DriverText({ snap, row, date }: { snap: Snapshot; row: BoardRow; date: string }) {
  const name = driverName(snap, row.driverId);
  const busy = row.unloads.length + row.loads.length > 0;
  const log = row.driverId ? workLogOf(snap, row.driverId, date) : undefined;
  return (
    <>
      {name || (busy ? <span className="ps-red">미지정</span> : '')}
      {log && log.work_types.length > 0 && <span className="ps-wt">{log.work_types.map((t) => WORK_TYPE_SHORT[t]).join('·')}</span>}
    </>
  );
}

function VehicleRow({ row, zone, date, a, staff }: { row: BoardRow; zone: Zone; date: string; a: Actions; staff: boolean }) {
  const snap = useSnap();
  const add = (kind: Kind) => (staff ? () => a.addOrder(zone, kind, row) : undefined);
  const status = row.status && row.status !== 'field' ? row.status : '';
  const vehicle = (
    <Tap className={`ps-pill veh ${row.inRepair ? 'repair' : ''}`} onTap={() => a.tapVehicle(row)} onLong={staff ? () => a.editStatus(row) : undefined}>
      {row.vehicle.short_no}
    </Tap>
  );
  const driverCell = (
    <TapCell className="drv" onTap={() => (staff ? a.editDriver(row) : a.tapVehicle(row))}>
      <DriverText snap={snap} row={row} date={date} />
    </TapCell>
  );
  return (
    <tr id={`sheet-${row.vehicle.id}`} className={row.secondary ? 'secondary' : ''}>
      <TapCell className="ship" onTap={() => (row.arrivalShip ? a.tapShip(row, 'arrival') : staff ? a.editShip(row, 'arrival') : undefined)}>
        <ShipText snap={snap} ship={row.arrivalShip} tag={row.arrivalTag} />
        {row.shipPending && <span className="ps-red"> 변경?</span>}
      </TapCell>
      <TapCell className="body" onTap={row.unloads.length ? undefined : add('unload')}>
        {status && !row.unloads.length && (
          <Tap className={`st ${status}`} onTap={() => a.editStatus(row)}>{DAY_STATUS_LABEL[status]}</Tap>
        )}
        {row.statusMemo && !row.unloads.length && <span className="ps-red"> {row.statusMemo}</span>}
        <Orders list={row.unloads} a={a} staff={staff} />
      </TapCell>
      {driverCell}
      <td className="veh">
        {vehicle}
        {row.secondary && <span className="ps-red small">왕복</span>}
      </td>
      <TapCell className="body" onTap={row.loads.length ? undefined : add('load')}>
        {status && row.unloads.length > 0 && !row.loads.length && (
          <Tap className={`st ${status}`} onTap={() => a.editStatus(row)}>{DAY_STATUS_LABEL[status]}</Tap>
        )}
        <Orders list={row.loads} a={a} staff={staff} />
      </TapCell>
      {driverCell}
      <TapCell className="ship" onTap={() => (row.departureShip ? a.tapShip(row, 'departure') : staff ? a.editShip(row, 'departure') : undefined)}>
        <ShipText snap={snap} ship={row.departureShip} tag={row.departureTag} />
      </TapCell>
    </tr>
  );
}

/** 배차 대기(노란 칸) · 용차·화주배차(빨간 글씨) 줄 */
function WaitingRow({ o, a, staff }: { o: DailyOrder; a: Actions; staff: boolean }) {
  const snap = useSnap();
  const ext = isExternal(o);
  const load = o.kind === 'load';
  const veh = ext
    ? <Tap className="ps-ext" onTap={() => a.openOrder(o, staff)}>{o.carrier_name || (o.carrier_type === 'shipper' ? '화주' : '용차')}{o.carrier_vehicle && <small> {o.carrier_vehicle.replace(/\s/g, '').slice(-4)}</small>}</Tap>
    : <Tap className="ps-pill wait" onTap={() => a.assign(o)}>{staff ? '배차' : '대기'}</Tap>;
  const ship = (
    <TapCell className="ship" onTap={staff ? () => a.editWaitingShip(o) : undefined}>
      {load ? <ShipText snap={snap} ship={o.departure_ship} tag={o.departure_ship_tag} /> : null}
    </TapCell>
  );
  return (
    <tr className={ext ? 'external' : 'waiting'} id={`sheet-${o.id}`}>
      <TapCell className="ship" onTap={!load && staff ? () => a.editWaitingShip(o) : undefined}>
        {!load && <ShipText snap={snap} ship={o.arrival_ship} tag={o.arrival_ship_tag} />}
      </TapCell>
      <td className="body">{!load && <Orders list={[o]} a={a} staff={staff} />}</td>
      <td className="drv" />
      <td className="veh">{veh}</td>
      <td className="body">{load && <Orders list={[o]} a={a} staff={staff} />}</td>
      <td className="drv" />
      {ship}
    </tr>
  );
}

/** 현장근무 줄: 근무지 | · | · | 차량 | 업무 | 이름 | · */
export function FieldRows({ date, rows, label }: { date: string; rows: FieldAssignment[]; label?: (f: FieldAssignment) => string }) {
  const snap = useSnap();
  const { staff } = useRole();
  const pick = usePickers();
  const save = (f: FieldAssignment) => store.run((tx) => saveFieldAssignment(tx, f));
  const editStaff = async (f: FieldAssignment) => {
    const id = await pick.staff(date);
    if (id) save({ ...f, staff_id: id });
  };
  const editTask = async (f: FieldAssignment) => {
    const t = await pick.memo(f.task, '업무');
    if (t !== null) save({ ...f, task: t });
  };
  const editVehicle = async (f: FieldAssignment) => {
    const v = await pick.anyVehicle();
    if (v !== undefined) save({ ...f, vehicle_id: v });
  };
  const siteName = (f: FieldAssignment) => label?.(f) ?? snap.field_sites.find((s) => s.id === f.site_id)?.name ?? '근무지 미정';
  return (
    <>
      {rows.map((f, i) => (
        <tr key={f.id} className={`fieldrow ${i === 0 ? 'first' : ''}`}>
          <td className="site">{i === 0 || siteName(rows[i - 1]) !== siteName(f) ? siteName(f) : ''}</td>
          <td className="body" />
          <td className="drv" />
          <TapCell className="veh" onTap={staff ? () => editVehicle(f) : undefined}>
            {f.vehicle_id && <span className="ps-pill veh">{vehicleNo(snap, f.vehicle_id)}</span>}
          </TapCell>
          <TapCell className="body" onTap={staff ? () => editTask(f) : undefined}>{f.task}</TapCell>
          <TapCell className="drv" onTap={staff ? () => editStaff(f) : undefined}>{driverName(snap, f.staff_id)}</TapCell>
          <td className="ship" />
        </tr>
      ))}
    </>
  );
}

export function SheetBoard(p: {
  zone: Zone; date: string; rows: BoardRow[]; waiting: DailyOrder[]; external: DailyOrder[]; field: FieldAssignment[]; actions: Actions;
}) {
  const { staff } = useRole();
  const snap = useSnap();
  const { groups } = sitesGrouped(snap, p.field);
  const fieldRows = groups.filter((g) => g.site.zone === p.zone).flatMap((g) => g.rows);
  return (
    <div className="paper-wrap">
      <table className={`paper ${p.zone}`}>
        <colgroup>
          <col className="c-ship" /><col className="c-body" /><col className="c-drv" /><col className="c-veh" />
          <col className="c-body" /><col className="c-drv" /><col className="c-ship" />
        </colgroup>
        <thead>
          <tr>{HEAD[p.zone].map((h, i) => <th key={i} className={i === 0 ? 'zone' : ''}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {p.rows.map((r) => <VehicleRow key={r.vehicle.id + (r.secondary ? '-2' : '')} row={r} zone={p.zone} date={p.date} a={p.actions} staff={staff} />)}
          {p.waiting.map((o) => <WaitingRow key={o.id} o={o} a={p.actions} staff={staff} />)}
          {p.external.map((o) => <WaitingRow key={o.id} o={o} a={p.actions} staff={staff} />)}
          {fieldRows.length > 0 && <FieldRows date={p.date} rows={fieldRows} />}
          {staff && (
            <tr className="addrow">
              <TapCell onTap={() => p.actions.addOrder(p.zone, 'unload')}>＋</TapCell>
              <TapCell className="body" onTap={() => p.actions.addOrder(p.zone, 'unload')}>＋ {p.zone === 'land' ? '하차' : '오전'}</TapCell>
              <td /><td />
              <TapCell className="body" onTap={() => p.actions.addOrder(p.zone, 'load')}>＋ {p.zone === 'land' ? '상차' : '오후'}</TapCell>
              <td /><td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** 육지·제주 어느 표에도 속하지 않은 근무지와 휴무자 */
export function SheetExtras({ date, field }: { date: string; field: FieldAssignment[] }) {
  const snap = useSnap();
  const { staff } = useRole();
  const pick = usePickers();
  const { groups, off } = sitesGrouped(snap, field);
  const rest = groups.filter((g) => !g.site.zone).flatMap((g) => g.rows);
  const add = async () => {
    const site = await pick.site();
    if (!site) return;
    const id = await pick.staff(date);
    if (id) store.run((tx) => saveFieldAssignment(tx, blankField({ date, site_id: site, staff_id: id, sort_order: field.length })));
  };
  if (!rest.length && !off.length && !staff) return null;
  return (
    <div className="paper-wrap">
      <table className="paper extra">
        <colgroup>
          <col className="c-ship" /><col className="c-body" /><col className="c-drv" /><col className="c-veh" />
          <col className="c-body" /><col className="c-drv" /><col className="c-ship" />
        </colgroup>
        <tbody>
          {rest.length > 0 && <FieldRows date={date} rows={rest} />}
          {off.length > 0 && (
            <tr className="fieldrow first">
              <td className="site">휴무</td>
              <td className="body" colSpan={6}>{off.map((f) => driverName(snap, f.staff_id)).filter(Boolean).join(', ')}</td>
            </tr>
          )}
          {staff && (
            <tr className="addrow">
              <TapCell onTap={add}>＋ 현장</TapCell>
              <td colSpan={6} className="muted small">근무지를 육지/제주 표에 보이게 하려면 차량·설정 › 현장에서 표시 위치를 고르세요.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
