// 일정표 칸 동작 (휴대폰·PC 공통)
import {
  ON_CALL_SHIFT, abbrev, acceptShipPending, nudgeVehicle, workLogOf, assignVehicle, blankOrder, buildBoard, createOrder, ignoreShipPending, opposite, saveOrder,
  DEFAULT_START, sails, PM_ARRIVAL_LABEL, setRowAmLabel, HELPER_ROLE_LABEL, START_PLACES, setRowNote, lastStart, startText, setRowStart, rowDriver, seqMark, setDriverSeq, setRowDriver, setRowHelper, setRowShip, setVehicleDayStatus, setVehicleZone, shipTime,
  type Board, type BoardRow, type DailyOrder, type DriverSide, type HelperRole, type Kind, type Zone,
} from '../domain/index.ts';
import { store } from '../data/store.ts';
import { useState } from 'react';
import { useRole, useSnap } from './hooks.ts';
import { ZONE_LABEL, clientName, driverName, kindLabel, productName, qtyText, shipText, vehicleNo } from './labels.ts';
import { fmtDate } from '../lib/time.ts';
import { OrderSheet, QuickQtySheet } from './OrderSheet.tsx';
import { EXTERNAL_HIRED, EXTERNAL_SHIPPER, PM_ARRIVAL, usePickers } from './pickers.tsx';
import { CarrierSheet } from './CarrierSheet.tsx';
import { Sheet, useSheet } from './Sheet.tsx';
import { VoyageSheet } from './ShipFares.tsx';

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

  /** startClient: 같은 거래처의 다른 품목을 이어서 넣을 때 (품목 고르기부터) */
  const addOrder = async (zone: Zone, kind: Kind, row?: BoardRow, startClient?: { id: string; text: string }) => {
    if (!staff) return;
    const c = await pick.clientProduct(row?.vehicle.id ?? null, startClient, !!row && !startClient);
    if (!c) return;
    if (c.noteOnly && row) return editNote(row, kind);
    const ship = kind === 'load'
      ? { departure_ship: row?.departureShip ?? null, departure_ship_tag: row?.departureTag ?? '' }
      : { arrival_ship: row?.arrivalShip ?? null, arrival_ship_tag: row?.arrivalTag ?? '' };
    const same = store.getState().snap.daily_orders.filter((o) => o.date === date && o.zone === zone && o.kind === kind);
    const order = blankOrder({
      date, zone, kind,
      client_id: c.client_id, client_text: c.client_text,
      product_id: c.product?.id ?? null, product_text: c.product_text,
      region: c.product?.default_region ?? '', quantity: c.product?.default_quantity ?? null, unit: c.product?.default_unit ?? '',
      vehicle_id: row?.vehicle.id ?? null, driver_id: row ? rowDriver(row, kind) : null,
      sort_order: same.length,
      ...ship,
    });
    store.run((tx) => createOrder(tx, order));
    const more = c.client_id ? { id: c.client_id, text: c.client_text } : undefined;
    sheet.open((close) => <QuickQtySheet orderId={order.id} close={close} onAddMore={more ? () => void addOrder(zone, kind, row, more) : undefined} />);
  };

  const openOrder = (o: DailyOrder, edit = false) =>
    sheet.open((close) => <OrderSheet orderId={o.id} close={close} startEditing={edit} />);

  const editShip = async (row: BoardRow, which: 'arrival' | 'departure') => {
    if (!staff || !row.zone) return;
    const cur = which === 'arrival' ? { ship: row.arrivalShip, tag: row.arrivalTag } : { ship: row.departureShip, tag: row.departureTag };
    const r = await pick.ship(row.zone, cur, which);
    if (!r) return;
    if (row.secondary) {
      // 당일 왕복 보조 줄: 차량의 그날 위치를 바꾸지 않도록 오더에 직접 저장
      store.run((tx) => {
        for (const o of which === 'arrival' ? row.unloads : row.loads) {
          saveOrder(tx, { ...o, ...(which === 'arrival' ? { arrival_ship: r.ship, arrival_ship_tag: r.tag } : { departure_ship: r.ship, departure_ship_tag: r.tag }) });
        }
      });
      return;
    }
    store.run((tx) => setRowShip(tx, { date, vehicle_id: row.vehicle.id, zone: row.zone!, which, ship: r.ship, tag: r.tag }));
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

  /** 오전/오후(육지: 하차/상차) 이름 */
  const sideLabel = (row: BoardRow, side: DriverSide) => (row.zone === 'jeju' ? (side === 'unload' ? '오전' : '오후') : side === 'unload' ? '하차' : '상차');

  const editDriver = async (row: BoardRow, side: DriverSide = 'unload') => {
    if (!staff) return;
    const d = await pick.driver(date, side === 'unload' ? row.driverId : row.loadDriverId, side === 'unload');
    if (d === undefined) return;
    if (d === PM_ARRIVAL) {
      store.run((tx) => setRowAmLabel(tx, { date, vehicle_id: row.vehicle.id, zone: row.zone, label: PM_ARRIVAL_LABEL }));
      // 오후 기사가 아직 없으면 바로 고르기
      const now = buildBoard(store.getState().snap, date).rows.find((r) => r.vehicle.id === row.vehicle.id && !r.secondary);
      if (now && !now.loadDriverId) await editDriver(now, 'load');
      return;
    }
    store.run((tx) => setRowDriver(tx, { date, vehicle_id: row.vehicle.id, zone: row.zone, driver_id: d, side }));
    // 알바는 출근한 날 근무형태를 바로 입력
    const snap = store.getState().snap;
    const drv = snap.drivers.find((x) => x.id === d);
    if (drv?.shift === ON_CALL_SHIFT && !workLogOf(snap, drv.id, date)) await pick.workType(date, drv.id);
  };

  /** 기사 없는 차량: 오전·오후 같은 기사로 할지, 오후만 정할지 */
  const assignDriver = async (row: BoardRow) => {
    if (!staff) return;
    const side = await sheet.confirm({
      title: `${row.vehicle.short_no} 기사 배정`,
      message: '',
      actions: [
        { label: `${sideLabel(row, 'unload')}·${sideLabel(row, 'load')} 같은 기사`, value: 'unload', kind: 'primary' },
        { label: `${sideLabel(row, 'load')}만 (${sideLabel(row, 'unload')}은 비움)`, value: 'load' },
        { label: '🚢 오후도착 (오전 기사 없음)', value: 'pm' },
      ],
    });
    if (side === 'pm') {
      store.run((tx) => setRowAmLabel(tx, { date, vehicle_id: row.vehicle.id, zone: row.zone, label: PM_ARRIVAL_LABEL }));
      const now = buildBoard(store.getState().snap, date).rows.find((r) => r.vehicle.id === row.vehicle.id && !r.secondary);
      if (now) await editDriver(now, 'load');
    } else if (side) await editDriver(row, side as DriverSide);
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

  /** 동승 기사 (선탑·교육 / 지원): 기사 고르고 → 역할 고르기 */
  const editHelper = async (row: BoardRow) => {
    if (!staff) return;
    const d = await pick.driver(date, row.helperId);
    if (d === undefined) return;
    if (!d) return store.run((tx) => setRowHelper(tx, { date, vehicle_id: row.vehicle.id, zone: row.zone, driver_id: null, role: '' }));
    const role = await new Promise<HelperRole | null>((resolve) => sheet.open((close) => (
      <Sheet title={`${driverName(store.getState().snap, d)} · 동승 역할`} onClose={() => { resolve(null); close(); }}>
        <div className="row" style={{ gap: 8 }}>
          {(Object.keys(HELPER_ROLE_LABEL) as HelperRole[]).map((r) => (
            <button key={r} className="grow primary" style={{ minHeight: 56, fontSize: 18 }} onClick={() => { resolve(r); close(); }}>{HELPER_ROLE_LABEL[r]}</button>
          ))}
        </div>
      </Sheet>
    )));
    if (role) store.run((tx) => setRowHelper(tx, { date, vehicle_id: row.vehicle.id, zone: row.zone, driver_id: d, role }));
  };

  /** 오전(하차)·오후(상차) 칸 비고만 (오더 없이). 빈 글자로 저장하면 지움 */
  const editNote = async (row: BoardRow, kind: Kind) => {
    if (!staff) return;
    const cur = (kind === 'unload' ? row.vd?.unload_note : row.vd?.load_note) ?? '';
    const t = await pick.memo(cur, `${row.vehicle.short_no} ${sideLabel(row, kind === 'unload' ? 'unload' : 'load')} 비고`);
    if (t === null) return;
    store.run((tx) => setRowNote(tx, { date, vehicle_id: row.vehicle.id, zone: row.zone, kind, note: t }));
  };

  /** 출근 시간·장소: 제주는 기본 07:00 부두, 바뀔 때만 고친다 */
  const editStart = (row: BoardRow) => {
    if (!staff) return;
    const prev = row.startTime || row.startPlace ? { time: row.startTime, place: row.startPlace } : row.zone === 'jeju' ? { ...DEFAULT_START } : lastStart(store.getState().snap, row.vehicle.id, date);
    sheet.open((close) => (
      <StartSheet title={`${row.vehicle.short_no} 출근 시간·장소`} initial={prev ?? { time: '', place: '' }} jeju={row.zone === 'jeju'} close={close}
        onSave={(time, place) => store.run((tx) => setRowStart(tx, { date, vehicle_id: row.vehicle.id, zone: row.zone, time, place }))} />
    ));
  };

  /** 처리 순서 (1번차·2번차…) 직접 고치기 */
  const editSeq = (row: BoardRow) => {
    const pickSeq = (side: DriverSide, cur: number | null) => (
      <div className="field" key={side}>
        <span>{sideLabel(row, side)} 기사 {driverName(store.getState().snap, side === 'unload' ? row.driverId : row.loadDriverId) || '미지정'}</span>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
          {[null, 1, 2, 3, 4, 5, 6].map((n) => (
            <button key={n ?? 0} className={`chip ${cur === n ? 'on' : ''}`}
              onClick={() => store.run((tx) => setDriverSeq(tx, { date, vehicle_id: row.vehicle.id, zone: row.zone, side, seq: n }))}>
              {n ? seqMark(n) : '없음'}
            </button>
          ))}
        </div>
      </div>
    );
    sheet.open((close) => <SeqSheet date={date} row={row} close={close} render={pickSeq} />);
  };

  /** 같은 구역 화면에 보이는 차량 순서 (위로/아래로는 화면에 보이는 이웃 기준) */
  const zoneRowIds = (row: BoardRow) => board.rows.filter((r) => r.zone === row.zone && !r.secondary).map((r) => r.vehicle.id);

  const tapVehicle = (row: BoardRow) => {
    const snap = store.getState().snap;
    showText(
      `${row.vehicle.short_no} 차량`,
      <>
        <div><b>{row.vehicle.plate}</b> · {row.vehicle.vehicle_type} · {row.vehicle.ownership}</div>
        <div>위치: {row.zone ? ZONE_LABEL[row.zone] : '미정'}</div>
        <div>{sideLabel(row, 'unload')} 기사: {driverName(snap, row.driverId) || '미지정'} {seqMark(row.unloadSeq)}</div>
        <div>{sideLabel(row, 'load')} 기사: {row.loadDriverId !== row.driverId ? driverName(snap, row.loadDriverId) : <span className="muted">{sideLabel(row, 'unload')}과 같음</span>} {seqMark(row.loadSeq)}</div>
        <div>출근: {startText(row) || <span className="muted">미정</span>}</div>
        <div>동승: {row.helperId ? <>{driverName(snap, row.helperId)} <span className="badge warn">{row.helperRole ? HELPER_ROLE_LABEL[row.helperRole] : '동승'}</span></> : <span className="muted">없음</span>}</div>
        {row.driverId && <div>근무형태: {workLogOf(snap, row.driverId, date)?.work_types.join(', ') || <span className="muted">미입력</span>}</div>}
        {row.inRepair && <div style={{ color: 'var(--red)' }}>수리 중 {row.statusMemo}</div>}
      </>,
      staff
        ? [
            { label: `${sideLabel(row, 'unload')} 기사`, run: () => void editDriver(row, 'unload') },
            { label: `${sideLabel(row, 'load')} 기사`, run: () => void editDriver(row, 'load') },
            { label: '순서 ①②', run: () => editSeq(row) },
            { label: '출근 시간·장소', run: () => editStart(row) },
            { label: '동승 (선탑·지원)', run: () => void editHelper(row) },
            ...(row.driverId ? [{ label: '근무형태', run: () => void pick.workType(date, row.driverId!) }] : []),
            ...(sails(row) ? [{ label: '🚢 선박 요금 (할증·승선)', run: () => sheet.open((close) => <VoyageSheet date={date} row={row} close={close} />) }] : []),
            { label: '상태·위치', run: () => void editStatus(row) },
            { label: '▲ 위로', run: () => store.run((tx) => nudgeVehicle(tx, row.vehicle.id, -1, zoneRowIds(row))) },
            { label: '▼ 아래로', run: () => store.run((tx) => nudgeVehicle(tx, row.vehicle.id, 1, zoneRowIds(row))) },
          ]
        : [],
    );
  };

  /** 배차 못 한 짐을 다른 날로 (상차면 연결된 반대편 하차도 함께 옮겨짐) */
  const moveDate = async (o: DailyOrder) => {
    const d = await pick.date(`${kindLabel(o.zone, o.kind)} 날짜 변경`, o.date);
    if (!d || d === o.date) return;
    store.run((tx) => saveOrder(tx, { ...tx.get('daily_orders', o.id)!, date: d }));
    store.toast(`${fmtDate(d)}로 옮겼습니다`);
  };

  /** [[ 상차짐 ]]: 전날 선박 "대기"로 싣고 있는 짐 → 오늘 선박 지정 / 원래 오더 보기 */
  const tapCarried = (row: BoardRow, o: DailyOrder) => {
    const snap = store.getState().snap;
    const shipped = o.ship_date === date && o.departure_ship;
    showText(
      `[[ 상차짐 ]] ${row.vehicle.short_no}`,
      <>
        <div><b>{clientName(snap, o)} {productName(snap, o)} {qtyText(o)}</b></div>
        <div className="muted">{fmtDate(o.date)} 상차 · {shipped ? `오늘 ${o.departure_ship} 선적` : '선박 대기 중'}</div>
        <p className="muted small">오늘 선박을 정하면 오늘 배에 실어 반대편 하차가 생깁니다. 또 "대기"면 내일로 이어집니다.</p>
      </>,
      staff
        ? [
            { label: '오늘 선박 지정', run: () => void editShip(row, 'departure'), kind: 'primary' },
            { label: '원래 오더 보기', run: () => openOrder(o) },
          ]
        : [{ label: '원래 오더 보기', run: () => openOrder(o) }],
    );
  };

  /** 노란 차량 칸 → 그날 그 지역 차량 목록에서 배차 → 그 차량 줄로 이동 */
  const assign = async (o: DailyOrder) => {
    if (!staff) return;
    const b = buildBoard(store.getState().snap, date);
    const vid = await pick.vehicle(b, o.zone, true);
    if (!vid) return;
    if (vid === EXTERNAL_HIRED || vid === EXTERNAL_SHIPPER) {
      // 용차·화주배차: 업체·차량번호·연락처만 적는 화면으로 바로
      sheet.open((close) => <CarrierSheet order={o} type={vid === EXTERNAL_HIRED ? 'hired' : 'shipper'} close={close} />);
      return;
    }
    const row = board.rows.find((r) => r.vehicle.id === vid);
    if (row?.inRepair && !confirm(`${row.vehicle.short_no} 차량은 수리 중입니다. 그래도 배차할까요?`)) return;
    store.run((tx) => assignVehicle(tx, o.id, vid, row ? rowDriver(row, o.kind) : null));
    store.toast(`${vehicleNo(store.getState().snap, vid)} 차량에 배차했습니다`);
    onFocusVehicle?.(vid);
  };

  const editWaitingShip = async (o: DailyOrder) => {
    if (!staff) return;
    const isLoad = o.kind === 'load';
    const r = await pick.ship(o.zone, isLoad ? { ship: o.departure_ship, tag: o.departure_ship_tag } : { ship: o.arrival_ship, tag: o.arrival_ship_tag }, isLoad ? 'departure' : 'arrival');
    if (r) store.run((tx) => saveOrder(tx, { ...o, ...(isLoad ? { departure_ship: r.ship, departure_ship_tag: r.tag } : { arrival_ship: r.ship, arrival_ship_tag: r.tag }) }));
  };

  return { addOrder, assignDriver, editNote, moveDate, tapCarried, openOrder, editShip, tapShip, editDriver, editSeq, editHelper, editStart, editStatus, tapVehicle, assign, editWaitingShip, showText, abbrev };
}

/** 출근 시간·장소 입력 */
function StartSheet({ title, initial, jeju, close, onSave }: { title: string; initial: { time: string; place: string }; jeju: boolean; close: () => void; onSave: (time: string, place: string) => void }) {
  const [time, setTime] = useState(initial.time);
  const [place, setPlace] = useState(initial.place);
  const save = (t: string, p: string) => { onSave(t, p); close(); };
  return (
    <Sheet title={title} onClose={close} footer={<>
      <button onClick={() => save('', '')}>{jeju ? `기본으로 (${DEFAULT_START.time} ${DEFAULT_START.place})` : '비우기'}</button>
      <button className="primary" onClick={() => save(time, place)}>저장</button>
    </>}>
      <label className="field"><span>출근 시간</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
      <div className="field">
        <span>출근 장소</span>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
          {START_PLACES.map((p) => <button key={p} className={`chip ${place === p ? 'on' : ''}`} style={{ minHeight: 44 }} onClick={() => setPlace(place === p ? '' : p)}>{p}</button>)}
        </div>
        <input style={{ marginTop: 6 }} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="직접 쓰기 (예: 애월 창고)" />
      </div>
    </Sheet>
  );
}

/** 순서 고치기 시트: 저장할 때마다 다시 그려지도록 최신 줄을 읽는다 */
function SeqSheet({ date, row, close, render }: { date: string; row: BoardRow; close: () => void; render: (side: DriverSide, cur: number | null) => React.ReactNode }) {
  const snap = useSnap();
  const cur = buildBoard(snap, date).rows.find((r) => r.vehicle.id === row.vehicle.id && !r.secondary) ?? row;
  return (
    <Sheet title={`${row.vehicle.short_no} 기사 처리 순서`} onClose={close} footer={<button className="primary" onClick={close}>닫기</button>}>
      <p className="muted">한 기사가 여러 차량을 맡을 때 몇 번째로 처리하는지 표시합니다. 같은 기사를 두 번째 차량에 지정하면 자동으로 매겨집니다.</p>
      {render('unload', cur.unloadSeq)}
      {render('load', cur.loadSeq)}
    </Sheet>
  );
}
