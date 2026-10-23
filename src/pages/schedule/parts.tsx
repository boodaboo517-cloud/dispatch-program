import { CARRIER_LABEL, DAY_STATUS_LABEL, HELPER_ROLE_LABEL, workText, WORK_TYPE_SHORT, abbrev, parseShip, seqMark, workLogOf, type BoardRow, type DailyOrder, type Snapshot } from '../../domain/index.ts';
import { clientName, driverName, productName, productOf, qtyText, shipTimeOf } from '../../ui/labels.ts';

export function hasMoney(snap: Snapshot, o: DailyOrder) {
  return snap.order_revenue.some((r) => r.order_id === o.id && r.total != null);
}

export function OrderMarks({ snap, o, staff }: { snap: Snapshot; o: DailyOrder; staff: boolean }) {
  const p = productOf(snap, o);
  const noMoney = staff && o.source !== 'linked' && !hasMoney(snap, o);
  const cold = p && p.storage !== 'ambient';
  const ext = o.carrier_type && o.carrier_type !== 'own';
  const bulk = o.kind === 'load' && o.shipment === 'bulk';
  const late = o.kind === 'load' && !o.same_day && o.arrival_offset != null && o.arrival_offset > 1;
  if (!cold && !o.linked_from_id && o.link_status !== 'source_changed' && !noMoney && !ext && !bulk && !late) return null;
  return (
    <span className="marks">
      {ext && <span className="mk ext" title={CARRIER_LABEL[o.carrier_type!]}>{o.carrier_type === 'hired' ? '용차' : '화주'}</span>}
      {bulk && <span className="mk bulk" title="벌크 (화물만 선적)">벌크</span>}
      {late && <span className="mk warn" title="반대편 하차가 늦게 도착">+{o.arrival_offset}일</span>}
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
      {workText(o) && <div className="l2" style={{ color: 'var(--red)', fontWeight: 700 }}>{abbrev(workText(o), 10)}</div>}
      <div className="l1">{abbrev(clientName(snap, o)) || '·'}</div>
      <div className="l2">{abbrev(productName(snap, o))} {qtyText(o)}</div>
      {o.kind === 'load' && o.shipment === 'bulk' && o.departure_ship && <div className="l2" style={{ color: '#075985' }}>🚢{abbrev(parseShip(o.departure_ship).name)}</div>}
      {o.memo && <div className="l2 muted">{abbrev(o.memo)}</div>}
    </>
  );
}

export function ShipCellText({ snap, ship, tag }: { snap: Snapshot; ship: string | null; tag: string }) {
  if (!ship) return <>＋</>;
  const { name, port } = parseShip(ship);
  return (
    <>
      {tag && <span className="tag" title={tag}>{abbrev(tag, 6)}</span>}
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
      {name ? <span className="drv">{abbrev(name, 4)}{seqMark(row.unloadSeq)}</span> : hasWork ? <span className="nodrv-badge">미배치</span> : null}
      {row.loadDriverId && row.loadDriverId !== row.driverId && (
        <span className="drv" title="오후(상차) 기사">→ {abbrev(driverName(snap, row.loadDriverId), 4)}{seqMark(row.loadSeq)}</span>
      )}
      {(!row.loadDriverId || row.loadDriverId === row.driverId) && row.loadSeq !== row.unloadSeq && row.loadSeq && <span className="drv">오후{seqMark(row.loadSeq)}</span>}
      {log && log.work_types.length > 0 && <span className="drv" style={{ color: '#1d4ed8' }}>{log.work_types.map((t) => WORK_TYPE_SHORT[t]).join('·')}</span>}
      {(row.startTime || row.startPlace) && <span className="drv" style={{ color: '#1d4ed8' }} title="출근 시간·장소">{row.startTime} {row.startPlace}</span>}
      {row.helperId && <span className="drv" style={{ color: '#b45309' }} title={row.helperRole ? HELPER_ROLE_LABEL[row.helperRole] : '동승'}>+{abbrev(driverName(snap, row.helperId), 3)} {row.helperRole}</span>}
      {row.secondary && <span className="mk link" title="당일 왕복 등 다른 구역 일정">왕복</span>}
    </>
  );
}

export function StatusChip({ row }: { row: BoardRow }) {
  if (!row.status || row.status === 'field') return null;
  return <span className={`st ${row.status}`}>{DAY_STATUS_LABEL[row.status]}</span>;
}

/** 용차·화주배차 칸: "용차 / 3456" */
export function CarrierText({ o }: { o: DailyOrder }) {
  const label = o.carrier_type === 'shipper' ? '화주배차' : '용차';
  const veh = o.carrier_vehicle ? o.carrier_vehicle.replace(/\s/g, '').slice(-4) : '';
  return (
    <>
      <span>{label}</span>
      {(veh || o.carrier_name) && <span className="small">{veh || abbrev(o.carrier_name ?? '', 4)}</span>}
    </>
  );
}
