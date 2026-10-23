// PC 넓은 표: 하차일정 | 상차일정, 차량 기준 같은 줄, 차량별 빨간 구분선, 4글자 축약 + 클릭 시 전체 보기
import { useState } from 'react';
import { abbrev, assignVehicle, isExternal, missingDriver, rowDriver, seqMark, type BoardRow, type DriverSide, type DailyOrder, type Zone } from '../../domain/index.ts';
import { store } from '../../data/store.ts';
import { useRole, useSnap } from '../../ui/hooks.ts';
import { Cell } from '../../ui/Cell.tsx';
import { clientName, driverName, productName, qtyText } from '../../ui/labels.ts';
import type { useBoardActions } from '../../ui/useBoardActions.tsx';
import { CarrierText, OrderMarks, ShipCellText, StatusChip } from './parts.tsx';

type Actions = ReturnType<typeof useBoardActions>;
const FIELDS = ['업체명', '지역', '품목', '수량', '비고'] as const;

export function PcBoard(p: { zone: Zone; rows: BoardRow[]; waiting: DailyOrder[]; external?: DailyOrder[]; actions: Actions; focus: string | null }) {
  const { staff } = useRole();
  const left = p.zone === 'land' ? '하차일정' : '오전';
  const right = p.zone === 'land' ? '상차일정' : '오후';
  const shipL = p.zone === 'land' ? '상행선박' : '도착선박';
  const shipR = p.zone === 'land' ? '하행선박' : '오후선박';
  return (
    <table className="pc-table">
      <colgroup>
        <col style={{ width: '6%' }} /><col style={{ width: '5%' }} /><col style={{ width: '5%' }} />
        <col /><col style={{ width: '5%' }} /><col /><col style={{ width: '4%' }} /><col />
        <col style={{ width: '5%' }} /><col style={{ width: '5%' }} />
        <col /><col style={{ width: '5%' }} /><col /><col style={{ width: '4%' }} /><col />
        <col style={{ width: '6%' }} />
      </colgroup>
      <thead>
        <tr><th className="grp" colSpan={8}>{left}</th><th className="grp" colSpan={8}>{right}</th></tr>
        <tr>
          <th>{shipL}</th><th>차량</th><th>기사</th>{FIELDS.map((f) => <th key={'l' + f}>{f}</th>)}
          <th>차량</th><th>기사</th>{FIELDS.map((f) => <th key={'r' + f}>{f}</th>)}<th>{shipR}</th>
        </tr>
      </thead>
      {p.rows.map((r) => <VehicleGroup key={r.vehicle.id} row={r} zone={p.zone} a={p.actions} staff={staff} focus={p.focus} />)}
      {p.waiting.map((o) => <WaitingGroup key={o.id} o={o} a={p.actions} />)}
      {p.external?.map((o) => <WaitingGroup key={o.id} o={o} a={p.actions} />)}
    </table>
  );
}

function OrderFields({ o, a, staff }: { o: DailyOrder; a: Actions; staff: boolean }) {
  const snap = useSnap();
  const vals = [clientName(snap, o), o.region, productName(snap, o), qtyText(o), o.memo];
  return (
    <>
      {vals.map((v, i) => (
        <td key={i}>
          <Cell onTap={() => a.openOrder(o)} onLong={staff ? () => a.openOrder(o, true) : undefined} title={v} draggableId={!o.vehicle_id ? o.id : undefined}>
            {abbrev(v)}
            {i === 0 && <OrderMarks snap={snap} o={o} staff={staff} />}
          </Cell>
        </td>
      ))}
    </>
  );
}

function EmptyFields({ onAdd }: { onAdd?: () => void }) {
  return (
    <>
      {FIELDS.map((f) => (
        <td key={f}>{onAdd ? <Cell className="empty add" onTap={onAdd}> </Cell> : null}</td>
      ))}
    </>
  );
}

function VehicleGroup({ row, zone, a, staff, focus }: { row: BoardRow; zone: Zone; a: Actions; staff: boolean; focus: string | null }) {
  const snap = useSnap();
  const [over, setOver] = useState(false);
  const hasOrders = row.unloads.length + row.loads.length > 0;
  const n = hasOrders ? Math.max(row.unloads.length, row.loads.length) + (staff ? 1 : 0) : 1;
  const focused = !!focus && (focus === row.vehicle.id || [...row.unloads, ...row.loads].some((o) => o.id === focus));
  const vehicleCell = (
    <td rowSpan={n}>
      <Cell className="vehicle" onTap={() => a.tapVehicle(row)} onLong={staff ? () => a.editStatus(row) : undefined}>
        {row.vehicle.short_no}
        {hasOrders && <StatusChip row={row} />}
      </Cell>
    </td>
  );
  const driverCell = (side: DriverSide) => {
    const drv = driverName(snap, side === 'unload' ? row.driverId : row.loadDriverId);
    const seq = side === 'unload' ? row.unloadSeq : row.loadSeq;
    return (
      <td rowSpan={n}>
        <Cell onTap={() => (drv || !staff ? a.tapVehicle(row) : a.editDriver(row, side))} onLong={staff ? () => a.editDriver(row, side) : undefined}>
          {drv ? <span style={{ fontSize: 13 }}>{abbrev(drv)}{seqMark(seq)}</span> : missingDriver(row, side) ? <span className="nodrv-badge">미배치</span> : null}
          {side === 'unload' && (row.startTime || row.startPlace) && <span style={{ fontSize: 12, color: '#1d4ed8' }}>{row.startTime} {row.startPlace}</span>}
          {row.helperId && <span style={{ fontSize: 12, color: '#b45309' }}>+{abbrev(driverName(snap, row.helperId), 3)} {row.helperRole}</span>}
        </Cell>
      </td>
    );
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData('text/order');
    if (!id || !staff) return;
    if (row.inRepair && !confirm(`${row.vehicle.short_no} 차량은 수리 중입니다. 그래도 배차할까요?`)) return;
    const kind = snap.daily_orders.find((o) => o.id === id)?.kind ?? 'unload';
    store.run((tx) => assignVehicle(tx, id, row.vehicle.id, rowDriver(row, kind)));
  };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const u = row.unloads[i];
    const l = row.loads[i];
    rows.push(
      <tr key={i}>
        {i === 0 && (
          <td rowSpan={n}>
            <Cell className="ship" onTap={() => a.tapShip(row, 'arrival')} onLong={staff ? () => a.editShip(row, 'arrival') : undefined}>
              <ShipCellText snap={snap} ship={row.arrivalShip} tag={row.arrivalTag} />
              {row.shipPending && <span className="mk warn">변경?</span>}
            </Cell>
          </td>
        )}
        {i === 0 && vehicleCell}
        {i === 0 && driverCell('unload')}
        {hasOrders ? (
          <>
            {u ? <OrderFields o={u} a={a} staff={staff} /> : <EmptyFields onAdd={staff ? () => a.addOrder(zone, 'unload', row) : undefined} />}
            {i === 0 && <td rowSpan={n} className="sep"><Cell className="vehicle" onTap={() => a.tapVehicle(row)}>{row.vehicle.short_no}</Cell></td>}
            {i === 0 && driverCell('load')}
            {l ? <OrderFields o={l} a={a} staff={staff} /> : <EmptyFields onAdd={staff ? () => a.addOrder(zone, 'load', row) : undefined} />}
          </>
        ) : (
          <td colSpan={12} className="sep">
            <div className="status-cell" onClick={() => a.editStatus(row)}>
              <StatusChip row={row} />
              <span>{row.statusMemo}</span>
            </div>
          </td>
        )}
        {i === 0 && (
          <td rowSpan={n}>
            <Cell className="ship" onTap={() => a.tapShip(row, 'departure')} onLong={staff ? () => a.editShip(row, 'departure') : undefined}>
              <ShipCellText snap={snap} ship={row.departureShip} tag={row.departureTag} />
            </Cell>
          </td>
        )}
      </tr>,
    );
  }
  return (
    <tbody
      id={`row-${row.vehicle.id}`}
      className="vgroup"
      style={{ outline: over ? '3px solid var(--blue)' : focused ? '3px solid #93c5fd' : undefined }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {rows}
    </tbody>
  );
}

function WaitingGroup({ o, a }: { o: DailyOrder; a: Actions }) {
  const snap = useSnap();
  const { staff } = useRole();
  const isLoad = o.kind === 'load';
  const ext = isExternal(o);
  const vcell = ext
    ? <Cell className="ext" onTap={() => a.openOrder(o, staff)}><CarrierText o={o} /></Cell>
    : <Cell className="yellow" onTap={() => a.assign(o)}>{staff ? '배차' : ''}</Cell>;
  const yellow = <td>{!isLoad && vcell}</td>;
  return (
    <tbody className={`vgroup ${ext ? 'external' : 'waiting'}`} id={`row-${o.id}`}>
      <tr>
        <td>{!isLoad && <Cell className="ship" onTap={() => a.editWaitingShip(o)}><ShipCellText snap={snap} ship={o.arrival_ship} tag={o.arrival_ship_tag} /></Cell>}</td>
        {yellow}
        <td />
        {isLoad ? <EmptyFields /> : <OrderFields o={o} a={a} staff={staff} />}
        <td className="sep">{isLoad && vcell}</td>
        <td />
        {isLoad ? <OrderFields o={o} a={a} staff={staff} /> : <EmptyFields />}
        <td>{isLoad && <Cell className="ship" onTap={() => a.editWaitingShip(o)}><ShipCellText snap={snap} ship={o.departure_ship} tag={o.departure_ship_tag} /></Cell>}</td>
      </tr>
    </tbody>
  );
}
