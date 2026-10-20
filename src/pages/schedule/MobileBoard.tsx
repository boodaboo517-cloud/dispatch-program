import type { BoardRow, DailyOrder, Zone } from '../../domain/index.ts';
import { useRole, useSnap } from '../../ui/hooks.ts';
import { Cell } from '../../ui/Cell.tsx';
import type { useBoardActions } from '../../ui/useBoardActions.tsx';
import { OrderCellText, OrderMarks, ShipCellText, StatusChip, VehicleCellText } from './parts.tsx';

type Actions = ReturnType<typeof useBoardActions>;

export function MobileBoard(p: { zone: Zone; rows: BoardRow[]; waiting: DailyOrder[]; actions: Actions; focus: string | null }) {
  const { zone, actions: a } = p;
  const L = zone === 'land' ? ['상행', '차량', '하차', '상차', '하행'] : ['도착', '차량', '오전', '오후', '오후선박'];
  return (
    <div>
      <div className="board-head">{L.map((l) => <div key={l}>{l}</div>)}</div>
      {p.rows.map((row) => <VehicleRow key={row.vehicle.id} row={row} zone={zone} a={a} focus={p.focus} />)}
      {p.waiting.length > 0 && (
        <>
          <div className="group-label">배차 대기 {p.waiting.length}건 · 노란 칸을 눌러 배차</div>
          {p.waiting.map((o) => <WaitingRow key={o.id} o={o} a={a} />)}
        </>
      )}
    </div>
  );
}

function VehicleRow({ row, zone, a, focus }: { row: BoardRow; zone: Zone; a: Actions; focus: string | null }) {
  const snap = useSnap();
  const { staff } = useRole();
  const hasOrders = row.unloads.length + row.loads.length > 0;
  const focused = !!focus && (focus === row.vehicle.id || [...row.unloads, ...row.loads].some((o) => o.id === focus));
  const orderCells = (list: DailyOrder[], kind: 'unload' | 'load') => (
    <div className="col">
      {list.map((o) => (
        <Cell key={o.id} onTap={() => a.openOrder(o)} onLong={staff ? () => a.openOrder(o, true) : undefined}>
          <OrderMarks snap={snap} o={o} staff={staff} />
          <OrderCellText snap={snap} o={o} />
        </Cell>
      ))}
      {staff && <Cell className="add" onTap={() => a.addOrder(zone, kind, row)}>＋</Cell>}
    </div>
  );
  return (
    <div id={`row-${row.vehicle.id}`} className="vrow" style={focused ? { boxShadow: '0 0 0 4px #93c5fd' } : undefined}>
      <div className="col">
        <Cell className="ship" onTap={() => a.tapShip(row, 'arrival')} onLong={staff ? () => a.editShip(row, 'arrival') : undefined}>
          <ShipCellText snap={snap} ship={row.arrivalShip} tag={row.arrivalTag} />
          {row.shipPending && <span className="mk warn">변경?</span>}
        </Cell>
      </div>
      <div className="col">
        <Cell className="vehicle" onTap={() => (row.driverId || !staff ? a.tapVehicle(row) : a.editDriver(row))} onLong={staff ? () => a.editDriver(row) : undefined}>
          <VehicleCellText snap={snap} row={row} />
          {hasOrders && <StatusChip row={row} />}
        </Cell>
      </div>
      {hasOrders ? (
        <>
          {orderCells(row.unloads, 'unload')}
          {orderCells(row.loads, 'load')}
        </>
      ) : (
        <div className="status-cell" onClick={() => a.editStatus(row)}>
          <StatusChip row={row} />
          <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.statusMemo}</span>
        </div>
      )}
      <div className="col">
        <Cell className="ship" onTap={() => a.tapShip(row, 'departure')} onLong={staff ? () => a.editShip(row, 'departure') : undefined}>
          <ShipCellText snap={snap} ship={row.departureShip} tag={row.departureTag} />
        </Cell>
      </div>
    </div>
  );
}

function WaitingRow({ o, a }: { o: DailyOrder; a: Actions }) {
  const snap = useSnap();
  const { staff } = useRole();
  const isLoad = o.kind === 'load';
  const cell = (
    <Cell onTap={() => a.openOrder(o)} onLong={staff ? () => a.assign(o) : undefined} draggableId={o.id}>
      <OrderMarks snap={snap} o={o} staff={staff} />
      <OrderCellText snap={snap} o={o} />
    </Cell>
  );
  return (
    <div className="vrow waiting" id={`row-${o.id}`}>
      <div className="col">
        {!isLoad && <Cell className="ship" onTap={() => a.editWaitingShip(o)}><ShipCellText snap={snap} ship={o.arrival_ship} tag={o.arrival_ship_tag} /></Cell>}
      </div>
      <div className="col"><Cell className="yellow" onTap={() => a.assign(o)}>{staff ? '배차' : ''}</Cell></div>
      <div className="col">{!isLoad && cell}</div>
      <div className="col">{isLoad && cell}</div>
      <div className="col">
        {isLoad && <Cell className="ship" onTap={() => a.editWaitingShip(o)}><ShipCellText snap={snap} ship={o.departure_ship} tag={o.departure_ship_tag} /></Cell>}
      </div>
    </div>
  );
}
