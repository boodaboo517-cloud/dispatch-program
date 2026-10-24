// 기사 조회 전용 화면: 내 배차 카드 (수정 버튼 없음). 전체 일정 보기는 관리자·배차가 볼 때만
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HELPER_ROLE_LABEL, addDays, workText, buildBoard, buildIndex, isDriverWorking, type BoardRow, type Snapshot } from '../domain/index.ts';

/** 내가 맡은 쪽(오전/오후)과 그날 처리 순서 */
function myPart(row: BoardRow, me: string | null) {
  const helper = !!me && row.helperId === me;
  const unload = !!me && (row.driverId === me || helper);
  const load = !!me && (row.loadDriverId === me || helper);
  const seqs = [unload ? row.unloadSeq : null, load ? row.loadSeq : null].filter((n): n is number => !!n);
  return { unload, load, helper, seq: helper ? null : seqs.length ? Math.min(...seqs) : null };
}
import { store } from '../data/store.ts';
import { fmtDate, fmtStamp, seoulToday } from '../lib/time.ts';
import { useSession, useSnap } from '../ui/hooks.ts';
import { clientName, driverName, productName, productOf, qtyText, setting, shipText, shipTimeOf, ZONE_LABEL } from '../ui/labels.ts';
import { StorageBadge, tempText } from '../ui/OrderSheet.tsx';
import { OverviewPage } from './OverviewPage.tsx';
import { DateBar } from './SchedulePage.tsx';

function DispatchCard({ row, date, title, me }: { row: BoardRow; date: string; title?: string; me: string | null }) {
  const snap = useSnap();
  const nav = useNavigate();
  const z = row.zone ?? 'land';
  const part = myPart(row, me);
  // 기사가 연결되지 않은 경우 등은 둘 다 보여 준다
  const showUnload = part.unload || !part.load;
  const showLoad = part.load || !part.unload;
  const line = (o: (typeof row.unloads)[number], i: number) => {
    const p = productOf(snap, o);
    return (
      <li key={o.id} onClick={() => p && nav(`/products/${p.id}`)} style={{ cursor: p ? 'pointer' : 'default' }}>
        <b>{clientName(snap, o)}</b> {productName(snap, o)} {qtyText(o)} {o.region && <span className="muted">· {o.region}</span>}
        {p && <> <StorageBadge storage={p.storage} temp={tempText(p)} /></>}
        {(o.pickup_place || o.dropoff_place) && <div>📍 {o.pickup_place || '-'} → {o.dropoff_place || '-'}</div>}
        {o.same_day && <div className="badge warn">당일 왕복</div>}
        {workText(o) && <div style={{ color: 'var(--red)', fontWeight: 800 }}>⏰ {workText(o)}</div>}
        {o.memo && <div className="muted">📝 {o.memo}</div>}
        {i >= 0 && p && <div className="muted small">눌러서 주소·길찾기·전화 ›</div>}
      </li>
    );
  };
  const latest = [row.vd, ...row.unloads, ...row.loads].filter(Boolean).map((x) => x!).sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0];
  return (
    <div className="drv-card" style={{ margin: '10px 0' }}>
      {title && <div className="muted">{title}</div>}
      {part.seq && <div className="badge warn" style={{ fontSize: 16 }}>{part.seq}번째 차량</div>}
      {part.helper && <div className="badge warn" style={{ fontSize: 16 }}>동승 · {row.helperRole ? HELPER_ROLE_LABEL[row.helperRole] : '동승'} (기사 {driverName(snap, row.driverId) || '미지정'})</div>}
      <div className="plate">{row.vehicle.short_no}</div>
      {(row.startTime || row.startPlace) && <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 800, color: '#1d4ed8' }}>출근 {row.startTime} {row.startPlace}</div>}
      <div style={{ textAlign: 'center' }} className="muted">{fmtDate(date)} · {ZONE_LABEL[z]} · {row.vehicle.plate}</div>
      {showUnload && <><h3>{z === 'land' ? '하차' : '오전'} {row.unloads.length}건 {row.arrivalShip && <span className="badge ok">{z === 'land' ? '상행' : '도착'} {shipText(row.arrivalShip, row.arrivalTag)}</span>}</h3>
      {row.unloads.length ? <ol>{row.unloads.map(line)}</ol> : <p className="muted">없음</p>}</>}
      {showLoad && <><h3>{z === 'land' ? '상차' : '오후'} {row.loads.length}건 {row.departureShip && <span className="badge red">{z === 'land' ? '하행' : '출발'} {shipText(row.departureShip, row.departureTag)} {shipTimeOf(snap, row.departureShip)}</span>}</h3>
      {row.loads.length ? <ol>{row.loads.map(line)}</ol> : <p className="muted">없음</p>}</>}
      {!row.unloads.length && !row.loads.length && row.statusMemo && <p>{row.statusMemo}</p>}
      {latest?.updated_at && <div className="muted small">마지막 변경 {fmtStamp(latest.updated_at)} {store.profileName(latest.updated_by) && `· ${store.profileName(latest.updated_by)}`}</div>}
    </div>
  );
}

/** 현장근무·휴무 (차량 배차 줄이 아닌 일정) */
function myDay(snap: Snapshot, driverId: string | null, date: string) {
  if (!driverId) return { field: [], off: false };
  const rows = snap.field_assignments.filter((f) => f.date === date && f.staff_id === driverId);
  const field = rows.filter((f) => !f.is_off);
  const me = snap.drivers.find((d) => d.id === driverId);
  const off = rows.some((f) => f.is_off) || (!field.length && !!me && !isDriverWorking(snap, me, date));
  return { field, off };
}

function FieldCard({ snap, date, driverId, title }: { snap: Snapshot; date: string; driverId: string | null; title?: string }) {
  const { field, off } = myDay(snap, driverId, date);
  if (!field.length && !off) return null;
  return (
    <div className="card">
      <div className="muted small">{title ?? fmtDate(date)}</div>
      {field.map((f) => (
        <div key={f.id} style={{ marginTop: 4 }}>
          <b style={{ fontSize: 20 }}>👷 현장근무 · {snap.field_sites.find((s) => s.id === f.site_id)?.name ?? '근무지 미정'}</b>
          {f.task && <div style={{ fontSize: 17 }}>{f.task}</div>}
          {f.vehicle_id && <div className="muted">차량 {snap.vehicles.find((v) => v.id === f.vehicle_id)?.short_no}</div>}
        </div>
      ))}
      {!field.length && off && <b style={{ fontSize: 20, color: 'var(--red)' }}>휴무</b>}
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
  const viewer = (session?.role ?? 'viewer') === 'viewer';
  const nav = useNavigate();
  const idx = useMemo(() => buildIndex(snap), [snap]);
  const board = useMemo(() => buildBoard(snap, date, idx), [snap, date, idx]);
  const tomorrow = useMemo(() => buildBoard(snap, addDays(date, 1), idx), [snap, date, idx]);
  const mine = (b: typeof board) => b.rows
    .filter((r) => !!driverId && (r.driverId === driverId || r.loadDriverId === driverId || r.helperId === driverId))
    .sort((a, b) => (myPart(a, driverId).seq ?? 99) - (myPart(b, driverId).seq ?? 99));
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
      {/* 기사 계정은 내 배차만. 관리자·배차가 "기사 화면 보기"로 볼 때만 전체 일정 탭 */}
      {!viewer && (
        <div className="tabs">
          <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>내 배차</button>
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>전체 일정 보기</button>
        </div>
      )}
      {tab === 'mine' || viewer ? (
        <>
          <DateBar date={date} onChange={setDate} />
          {!driverId && <div className="banner yellow">이 계정에 기사가 연결되어 있지 않습니다. 관리자에게 "설정 → 사용자 권한"에서 연결을 요청하세요.</div>}
          {mine(board).map((r) => <DispatchCard key={r.vehicle.id} row={r} date={date} me={driverId} />)}
          {!mine(board).length && <FieldCard snap={snap} date={date} driverId={driverId} />}
          {driverId && !mine(board).length && !myDay(snap, driverId, date).field.length && !myDay(snap, driverId, date).off && <div className="card" style={{ textAlign: 'center' }}>이 날 배차가 없습니다</div>}
          {mine(tomorrow).map((r) => (
            <div key={r.vehicle.id} style={{ opacity: 0.8 }}><DispatchCard row={r} date={addDays(date, 1)} title="내일 배차 미리보기" me={driverId} /></div>
          ))}
          {!mine(tomorrow).length && <div style={{ opacity: 0.8 }}><FieldCard snap={snap} date={addDays(date, 1)} driverId={driverId} title="내일 미리보기" /></div>}
        </>
      ) : (
        <OverviewPage embedded />
      )}
      {dispatcher && (
        <a href={`tel:${dispatcher}`} style={{ display: 'block', marginTop: 12 }}><button className="primary" style={{ width: '100%', minHeight: 56, fontSize: 19 }}>📞 배차 담당 전화</button></a>
      )}
      {viewer && <button style={{ width: '100%', marginTop: 12 }} onClick={() => nav('/settings')}>⚙ 설정 · 비밀번호 · 로그아웃</button>}
    </div>
  );
}
