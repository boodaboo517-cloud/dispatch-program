import { DAY_STATUS_LABEL, WORK_TYPE_SHORT, abbrev, parseShip, workLogOf, type BoardRow, type DailyOrder, type Snapshot } from '../../domain/index.ts';
import { clientName, driverName, productName, productOf, qtyText, shipTimeOf } from '../../ui/labels.ts';

export function hasMoney(snap: Snapshot, o: DailyOrder) {
  return snap.order_revenue.some((r) => r.order_id === o.id && r.total != null);
}

export function OrderMarks({ snap, o, staff }: { snap: Snapshot; o: DailyOrder; staff: boolean }) {
  const p = productOf(snap, o);
  const noMoney = staff && o.source !== 'linked' && !hasMoney(snap, o);
  const cold = p && p.storage !== 'ambient';
  if (!cold && !o.linked_from_id && o.link_status !== 'source_changed' && !noMoney) return null;
  return (
    <span className="marks">
      {p && p.storage !== 'ambient' && <span className={`dot ${p.storage}`} title={p.storage === 'chilled' ? '냉장' : '냉동'} />}
      {o.linked_from_id && <span className="mk link" title="상차와 연결됨">🔗</span>}
      {o.link_status === 'source_changed' && <span className="mk warn">!</span>}
      {noMoney && <span className="mk money" title="금액 미입력">₩</span>}
    </span>
  );
}

export function OrderCellText({ snap, o }: { snap: Snapshot; o: DailyOrder }) {
  return (
    <>
      <div className="l1">{abbrev(clientName(snap, o)) || '·'}</div>
      <div className="l2">{abbrev(productName(snap, o))} {qtyText(o)}</div>
      {o.memo && <div className="l2 muted">{abbrev(o.memo)}</div>}
    </>
  );
}

export function ShipCellText({ snap, ship, tag }: { snap: Snapshot; ship: string | null; tag: string }) {
  if (!ship) return <>＋</>;
  const { name, port } = parseShip(ship);
  return (
    <>
      {tag && <span className="tag">{tag}</span>}
      <span>{abbrev(name)}</span>
      {port && <span className="small" style={{ color: '#0369a1' }}>{abbrev(port, 3)}</span>}
      <span className="muted small">{shipTimeOf(snap, ship)}</span>
    </>
  );
}

export function VehicleCellText({ snap, row, date }: { snap: Snapshot; row: BoardRow; date: string }) {
  const hasWork = row.unloads.length + row.loads.length > 0;
  const name = driverName(snap, row.driverId);
  const log = row.driverId ? workLogOf(snap, row.driverId, date) : undefined;
  return (
    <>
      <span>{row.vehicle.short_no}</span>
      <span className={`drv${!name && hasWork ? ' none' : ''}`}>{name ? abbrev(name, 4) : hasWork ? '기사 미지정' : ''}</span>
      {log && log.work_types.length > 0 && <span className="drv" style={{ color: '#1d4ed8' }}>{log.work_types.map((t) => WORK_TYPE_SHORT[t]).join('·')}</span>}
      {row.secondary && <span className="mk link" title="당일 왕복 등 다른 구역 일정">왕복</span>}
    </>
  );
}

export function StatusChip({ row }: { row: BoardRow }) {
  if (!row.status || row.status === 'field') return null;
  return <span className={`st ${row.status}`}>{DAY_STATUS_LABEL[row.status]}</span>;
}
