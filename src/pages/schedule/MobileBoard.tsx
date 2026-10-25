import type { BoardRow, DailyOrder, Zone } from '../../domain/index.ts';
import { useRole, useSnap } from '../../ui/hooks.ts';
import { Cell } from '../../ui/Cell.tsx';
import type { useBoardActions } from '../../ui/useBoardActions.tsx';
import { isExternal } from '../../domain/index.ts';
import { CarrierText, OrderCellText, OrderMarks, ShipCellText, StatusChip, VehicleCellText, unloadInfo } from './parts.tsx';

type Actions = ReturnType<typeof useBoardActions>;

export function MobileBoard(p: { date: string; zone: Zone; rows: BoardRow[]; waiting: DailyOrder[]; external?: DailyOrder[]; actions: Actions; focus: string | null }) {
  const { zone, actions: a } = p;
  const L = zone === 'land' ? ['상행', '차량', '하차', '상차', '하행'] : ['도착', '차량', '오전', '오후', '오후선박'];
  return (
    <div>
      <div className="board-head">{L.map((l) => <div key={l}>{l}</div>)}</div>
      {p.rows.map((row) => <VehicleRow key={row.vehicle.id} date={p.date} row={row} zone={zone} a={a} focus={p.focus} />)}
      {p.waiting.length > 0 && (
        <>
          <div className="group-label">배차 대기 {p.waiting.length}건 · 노란 칸을 눌러 배차</div>
          {p.waiting.map((o) => <WaitingRow key={o.id} o={o} a={a} />)}
        </>
      )}
      {!!p.external?.length && (
        <>
          <div className="group-label" style={{ color: '#9a3412' }}>용차·화주배차 {p.external.length}건</div>
          {p.external.map((o) => <WaitingRow key={o.id} o={o} a={a} />)}
        </>
      )}
    </div>
  );
}

function VehicleRow({ date, row, zone, a, focus }: { date: string; row: BoardRow; zone: Zone; a: Actions; focus: string | null }) {
  const snap = useSnap();
  const { staff } = useRole();
  const info = unloadInfo(snap, row);
  const hasOrders = row.unloads.length + row.loads.length + row.carried.length + info.length > 0 || !!row.unloadNote || !!row.loadNote;
  const focused = !!focus && (focus === row.vehicle.id || [...row.unloads, ...row.loads].some((o) => o.id === focus));
  const orderCells = (list: DailyOrder[], kind: 'unload' | 'load') => (
    <div className="col">
      {kind === 'load' && row.carried.map((o) => (
        <Cell key={`c-${o.id}`} className="carried" onTap={() => a.tapCarried(row, o)}>
          <div className="l1">[[ 상차짐 ]]</div>
          <OrderCellText snap={snap} o={o} />
        </Cell>
      ))}
      {list.map((o) => (
        <Cell key={o.id} onTap={() => a.openOrder(o)} onLong={staff ? () => a.openOrder(o, true) : undefined}>
          <OrderMarks snap={snap} o={o} staff={staff} />
          <OrderCellText snap={snap} o={o} />
        </Cell>
      ))}
      {kind === 'unload' && info.map((t) => <Cell key={t} className="rownote info" onTap={() => undefined}>{t}</Cell>)}
      {(kind === 'unload' ? row.unloadNote : row.loadNote) && (
        <Cell className="rownote" onTap={() => (staff ? void a.editNote(row, kind) : undefined)}>📝 {kind === 'unload' ? row.unloadNote : row.loadNote}</Cell>
      )}
      {staff && <Cell className="add" onTap={() => a.addOrder(zone, kind, row)}>＋</Cell>}
    </div>
  );
  return (
    <div id={`row-${row.vehicle.id}`} className={`vrow${row.secondary ? ' secondary' : ''}`} style={focused ? { boxShadow: '0 0 0 4px #93c5fd' } : undefined}>
      <div className="col">
        <Cell className="ship" onTap={() => a.tapShip(row, 'arrival')} onLong={staff ? () => a.editShip(row, 'arrival') : undefined}>
          <ShipCellText snap={snap} ship={row.arrivalShip} tag={row.arrivalTag} />
          {row.shipPending && <span className="mk warn">변경?</span>}
        </Cell>
      </div>
      <div className="col">
        <Cell className="vehicle" onTap={() => (row.driverId || row.loadDriverId || !staff ? a.tapVehicle(row) : void a.assignDriver(row))} onLong={staff ? () => a.editDriver(row) : undefined}>
          <VehicleCellText snap={snap} row={row} date={date} />
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
    <div className={`vrow ${isExternal(o) ? 'external' : 'waiting'}`} id={`row-${o.id}`}>
      <div className="col">
        {!isLoad && <Cell className="ship" onTap={() => a.editWaitingShip(o)}><ShipCellText snap={snap} ship={o.arrival_ship} tag={o.arrival_ship_tag} /></Cell>}
      </div>
      <div className="col">
        {isExternal(o)
          ? <Cell className="ext" onTap={() => a.openOrder(o, staff)}><CarrierText o={o} /></Cell>
          : <Cell className="yellow" onTap={() => a.assign(o)}>{staff ? '배차' : ''}</Cell>}
      </div>
      <div className="col">{!isLoad && cell}</div>
      <div className="col">{isLoad && cell}</div>
      <div className="col">
        {isLoad && <Cell className="ship" onTap={() => a.editWaitingShip(o)}><ShipCellText snap={snap} ship={o.departure_ship} tag={o.departure_ship_tag} /></Cell>}
      </div>
    </div>
  );
}
