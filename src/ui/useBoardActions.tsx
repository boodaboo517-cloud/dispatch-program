// 일정표 칸 동작 (휴대폰·PC 공통)
import {
  abbrev, acceptShipPending, assignVehicle, blankOrder, buildBoard, createOrder, ignoreShipPending, opposite, saveOrder,
  setRowDriver, setRowShip, setVehicleDayStatus, setVehicleZone, shipTime,
  type Board, type BoardRow, type DailyOrder, type Kind, type Zone,
} from '../domain/index.ts';
import { store } from '../data/store.ts';
import { useRole } from './hooks.ts';
import { ZONE_LABEL, driverName, shipText, vehicleNo } from './labels.ts';
import { OrderSheet, QuickQtySheet } from './OrderSheet.tsx';
import { usePickers } from './pickers.tsx';
import { Sheet, useSheet } from './Sheet.tsx';

export function useBoardActions(date: string, board: Board, onFocusVehicle?: (vehicleId: string) => void) {
  const sheet = useSheet();
  const pick = usePickers();
  const { staff } = useRole();

  const showText = (title: string, body: React.ReactNode, actions?: { label: string; run: () => void; kind?: string }[]) =>
    sheet.open((close) => (
      <Sheet title={title} onClose={close} footer={actions?.length ? actions.map((a) => <button key={a.label} className={a.kind} onClick={() => { close(); a.run(); }}>{a.label}</button>) : undefined}>
        <div style={{ fontSize: 19, padding: '12px 0', whiteSpace: 'pre-wrap' }}>{body}</div>
      </Sheet>
    ));

  const addOrder = async (zone: Zone, kind: Kind, row?: BoardRow) => {
    if (!staff) return;
    const c = await pick.clientProduct(row?.vehicle.id ?? null);
    if (!c) return;
    const ship = kind === 'load'
      ? { departure_ship: row?.departureShip ?? null, departure_ship_tag: row?.departureTag ?? '' }
      : { arrival_ship: row?.arrivalShip ?? null, arrival_ship_tag: row?.arrivalTag ?? '' };
    const same = store.getState().snap.daily_orders.filter((o) => o.date === date && o.zone === zone && o.kind === kind);
    const order = blankOrder({
      date, zone, kind,
      client_id: c.client_id, client_text: c.client_text,
      product_id: c.product?.id ?? null, product_text: c.product_text,
      region: c.product?.default_region ?? '', quantity: c.product?.default_quantity ?? null, unit: c.product?.default_unit ?? '',
      vehicle_id: row?.vehicle.id ?? null, driver_id: row?.driverId ?? null,
      sort_order: same.length,
      ...ship,
    });
    store.run((tx) => createOrder(tx, order));
    sheet.open((close) => <QuickQtySheet orderId={order.id} close={close} />);
  };

  const openOrder = (o: DailyOrder, edit = false) =>
    sheet.open((close) => <OrderSheet orderId={o.id} close={close} startEditing={edit} />);

  const editShip = async (row: BoardRow, which: 'arrival' | 'departure') => {
    if (!staff || !row.zone) return;
    const cur = which === 'arrival' ? { ship: row.arrivalShip, tag: row.arrivalTag } : { ship: row.departureShip, tag: row.departureTag };
    const r = await pick.ship(row.zone, cur);
    if (r) store.run((tx) => setRowShip(tx, { date, vehicle_id: row.vehicle.id, zone: row.zone!, which, ship: r.ship, tag: r.tag }));
  };

  const tapShip = (row: BoardRow, which: 'arrival' | 'departure') => {
    const ship = which === 'arrival' ? row.arrivalShip : row.departureShip;
    const tag = which === 'arrival' ? row.arrivalTag : row.departureTag;
    const pending = which === 'arrival' ? row.vd?.arrival_pending : null;
    if (!ship && !pending) {
      void editShip(row, which);
      return;
    }
    const snap = store.getState().snap;
    const actions: { label: string; run: () => void; kind?: string }[] = staff ? [{ label: '변경', run: () => void editShip(row, which) }] : [];
    if (pending && staff && row.vd) {
      const vdId = row.vd.id;
      actions.unshift(
        { label: `반영 (${shipText(pending.ship, pending.tag) || '비우기'})`, run: () => store.run((tx) => acceptShipPending(tx, vdId)), kind: 'primary' },
        { label: '무시', run: () => store.run((tx) => ignoreShipPending(tx, vdId)) },
      );
    }
    showText(
      `${row.vehicle.short_no} ${which === 'arrival' ? (row.zone === 'jeju' ? '도착 선박' : '상행선박') : row.zone === 'jeju' ? '오후 선박' : '하행선박'}`,
      <>
        {shipText(ship, tag) || '없음'} {ship && <span className="muted">{shipTime(snap, ship) !== '99:98' ? shipTime(snap, ship) : ''}</span>}
        {pending && <div className="banner yellow">전날 선박이 바뀌었습니다 → {shipText(pending.ship, pending.tag) || '없음'}</div>}
        {which === 'arrival' && row.vd?.arrival_from_id && <div className="muted">전날 출발 선박에서 자동으로 이어짐</div>}
      </>,
      actions,
    );
  };

  const editDriver = async (row: BoardRow) => {
    if (!staff) return;
    const d = await pick.driver(date, row.driverId);
    if (d !== undefined) store.run((tx) => setRowDriver(tx, { date, vehicle_id: row.vehicle.id, zone: row.zone, driver_id: d }));
  };

  const editStatus = async (row: BoardRow) => {
    const r = await pick.status(date, row.zone, { status: row.status, memo: row.statusMemo }, staff);
    if (!r) return;
    if (r.action === 'add-unload' && row.zone) return addOrder(row.zone, 'unload', row);
    if (r.action === 'add-load' && row.zone) return addOrder(row.zone, 'load', row);
    if (r.action === 'move-zone') {
      const z = row.zone ? opposite(row.zone) : 'land';
      store.run((tx) => setVehicleZone(tx, { date, vehicle_id: row.vehicle.id, zone: z }));
      store.toast(`${row.vehicle.short_no} → ${ZONE_LABEL[z]}`);
      return;
    }
    store.run((tx) => setVehicleDayStatus(tx, { date, vehicle_id: row.vehicle.id, zone: row.zone, status: r.status, memo: r.memo, maintenance: r.maintenance }));
  };

  const tapVehicle = (row: BoardRow) => {
    const snap = store.getState().snap;
    showText(
      `${row.vehicle.short_no} 차량`,
      <>
        <div><b>{row.vehicle.plate}</b> · {row.vehicle.vehicle_type} · {row.vehicle.ownership}</div>
        <div>위치: {row.zone ? ZONE_LABEL[row.zone] : '미정'}</div>
        <div>기사: {driverName(snap, row.driverId) || '기사 미지정'} {row.vehicle.default_driver_id && <span className="muted">(기본 {driverName(snap, row.vehicle.default_driver_id)})</span>}</div>
        {row.inRepair && <div style={{ color: 'var(--red)' }}>수리 중 {row.statusMemo}</div>}
      </>,
      staff ? [{ label: '기사 지정', run: () => void editDriver(row) }, { label: '상태·위치', run: () => void editStatus(row) }] : [],
    );
  };

  /** 노란 차량 칸 → 그날 그 지역 차량 목록에서 배차 → 그 차량 줄로 이동 */
  const assign = async (o: DailyOrder) => {
    if (!staff) return;
    const b = buildBoard(store.getState().snap, date);
    const vid = await pick.vehicle(b, o.zone);
    if (!vid) return;
    const row = board.rows.find((r) => r.vehicle.id === vid);
    if (row?.inRepair && !confirm(`${row.vehicle.short_no} 차량은 수리 중입니다. 그래도 배차할까요?`)) return;
    store.run((tx) => assignVehicle(tx, o.id, vid, row?.driverId ?? null));
    store.toast(`${vehicleNo(store.getState().snap, vid)} 차량에 배차했습니다`);
    onFocusVehicle?.(vid);
  };

  const editWaitingShip = async (o: DailyOrder) => {
    if (!staff) return;
    const isLoad = o.kind === 'load';
    const r = await pick.ship(o.zone, isLoad ? { ship: o.departure_ship, tag: o.departure_ship_tag } : { ship: o.arrival_ship, tag: o.arrival_ship_tag });
    if (r) store.run((tx) => saveOrder(tx, { ...o, ...(isLoad ? { departure_ship: r.ship, departure_ship_tag: r.tag } : { arrival_ship: r.ship, arrival_ship_tag: r.tag }) }));
  };

  return { addOrder, openOrder, editShip, tapShip, editDriver, editStatus, tapVehicle, assign, editWaitingShip, showText, abbrev };
}
