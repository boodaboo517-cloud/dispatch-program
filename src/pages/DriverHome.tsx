// 기사 조회 전용 화면: 내 배차 카드 / 전체 일정 보기 (수정 버튼 없음)
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, buildBoard, buildIndex, type BoardRow } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { fmtDate, fmtStamp, seoulToday } from '../lib/time.ts';
import { useSession, useSnap } from '../ui/hooks.ts';
import { clientName, productName, productOf, qtyText, setting, shipText, shipTimeOf, ZONE_LABEL } from '../ui/labels.ts';
import { StorageBadge, tempText } from '../ui/OrderSheet.tsx';
import { OverviewPage } from './OverviewPage.tsx';
import { DateBar } from './SchedulePage.tsx';
import { OdometerInput, OilBar } from './FleetPage.tsx';

function DispatchCard({ row, date, title }: { row: BoardRow; date: string; title?: string }) {
  const snap = useSnap();
  const nav = useNavigate();
  const z = row.zone ?? 'land';
  const line = (o: (typeof row.unloads)[number], i: number) => {
    const p = productOf(snap, o);
    return (
      <li key={o.id} onClick={() => p && nav(`/products/${p.id}`)} style={{ cursor: p ? 'pointer' : 'default' }}>
        <b>{clientName(snap, o)}</b> {productName(snap, o)} {qtyText(o)} {o.region && <span className="muted">· {o.region}</span>}
        {p && <> <StorageBadge storage={p.storage} temp={tempText(p)} /></>}
        {(o.pickup_place || o.dropoff_place) && <div>📍 {o.pickup_place || '-'} → {o.dropoff_place || '-'}</div>}
        {o.same_day && <div className="badge warn">당일 왕복</div>}
        {o.memo && <div className="muted">📝 {o.memo}</div>}
        {i >= 0 && p && <div className="muted small">눌러서 주소·길찾기·전화 ›</div>}
      </li>
    );
  };
  const latest = [row.vd, ...row.unloads, ...row.loads].filter(Boolean).map((x) => x!).sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0];
  return (
    <div className="drv-card" style={{ margin: '10px 0' }}>
      {title && <div className="muted">{title}</div>}
      <div className="plate">{row.vehicle.short_no}</div>
      <div style={{ textAlign: 'center' }} className="muted">{fmtDate(date)} · {ZONE_LABEL[z]} · {row.vehicle.plate}</div>
      <h3>{z === 'land' ? '하차' : '오전'} {row.unloads.length}건 {row.arrivalShip && <span className="badge ok">{z === 'land' ? '상행' : '도착'} {shipText(row.arrivalShip, row.arrivalTag)}</span>}</h3>
      {row.unloads.length ? <ol>{row.unloads.map(line)}</ol> : <p className="muted">없음</p>}
      <h3>{z === 'land' ? '상차' : '오후'} {row.loads.length}건 {row.departureShip && <span className="badge red">{z === 'land' ? '하행' : '출발'} {shipText(row.departureShip, row.departureTag)} {shipTimeOf(snap, row.departureShip)}</span>}</h3>
      {row.loads.length ? <ol>{row.loads.map(line)}</ol> : <p className="muted">없음</p>}
      {!row.unloads.length && !row.loads.length && row.statusMemo && <p>{row.statusMemo}</p>}
      {latest?.updated_at && <div className="muted small">마지막 변경 {fmtStamp(latest.updated_at)} {store.profileName(latest.updated_by) && `· ${store.profileName(latest.updated_by)}`}</div>}
    </div>
  );
}

export function DriverHome() {
  const snap = useSnap();
  const session = useSession();
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  const [date, setDate] = useState(seoulToday());
  const [notice, setNotice] = useState<string | null>(null);
  const driverId = session?.driverId ?? null;
  const idx = useMemo(() => buildIndex(snap), [snap]);
  const board = useMemo(() => buildBoard(snap, date, idx), [snap, date, idx]);
  const tomorrow = useMemo(() => buildBoard(snap, addDays(date, 1), idx), [snap, date, idx]);
  const mine = (b: typeof board) => b.rows.filter((r) => r.driverId && r.driverId === driverId);
  // 주행거리 입력 차량: 기본 기사 지정이 없으므로 이 날 내가 배차된 차량, 없으면 최근에 탄 차량
  const myVehicle = useMemo(() => {
    if (!driverId) return undefined;
    const today = mine(board)[0]?.vehicle;
    if (today) return today;
    const recent = snap.vehicle_days
      .filter((v) => v.driver_id === driverId && v.date <= date)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    return snap.vehicles.find((v) => v.id === recent?.vehicle_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, board, driverId, date]);
  const dispatcher = setting(snap, 'dispatcher_phone', '');

  useEffect(() => {
    store.onNotice = (m) => {
      setNotice(m);
      if ('Notification' in window && Notification.permission === 'granted') {
        void navigator.serviceWorker?.ready.then((r) => r.showNotification('경민물류 배차 변경', { body: m, tag: 'dispatch' }));
      }
    };
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    return () => {
      store.onNotice = null;
    };
  }, []);
  const lastNotice = snap.notices.filter((n) => n.driver_id === driverId && n.date >= seoulToday()).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const band = notice ?? lastNotice?.message;

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      {band && <div className="banner yellow" onClick={() => setNotice(null)}>🔔 {band} {lastNotice && !notice && <span className="muted small">{fmtStamp(lastNotice.created_at)}</span>}</div>}
      <div className="tabs">
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>내 배차</button>
        <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>전체 일정 보기</button>
      </div>
      {tab === 'mine' ? (
        <>
          <DateBar date={date} onChange={setDate} />
          {!driverId && <div className="banner yellow">이 계정에 기사가 연결되어 있지 않습니다. 관리자에게 "설정 → 사용자 권한"에서 연결을 요청하세요.</div>}
          {mine(board).map((r) => <DispatchCard key={r.vehicle.id} row={r} date={date} />)}
          {driverId && !mine(board).length && <div className="card" style={{ textAlign: 'center' }}>이 날 배차가 없습니다</div>}
          {mine(tomorrow).map((r) => (
            <div key={r.vehicle.id} style={{ opacity: 0.8 }}><DispatchCard row={r} date={addDays(date, 1)} title="내일 배차 미리보기" /></div>
          ))}
          {myVehicle && (
            <div className="card">
              <b>{myVehicle.short_no} 차량 주행거리 입력</b>
              <OdometerInput vehicleId={myVehicle.id} />
              <div style={{ marginTop: 8 }}><OilBar v={myVehicle} /></div>
            </div>
          )}
        </>
      ) : (
        <OverviewPage embedded />
      )}
      {dispatcher && (
        <a href={`tel:${dispatcher}`} style={{ display: 'block', marginTop: 12 }}><button className="primary" style={{ width: '100%', minHeight: 56, fontSize: 19 }}>📞 배차 담당 전화</button></a>
      )}
    </div>
  );
}
