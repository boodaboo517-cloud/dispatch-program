import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LOCK_DAYS, addDays, lockCutoff, type Role } from './domain/index.ts';
import { backupOverdue } from './data/backup.ts';
import { autoWeeklyEmail } from './data/emailBackup.ts';
import { store } from './data/store.ts';
import { isDemo, supabase } from './data/supabase.ts';
import { lastUrl, menuOf, menuUrl, remember, saveScroll, scrollOf } from './lib/navMemory.ts';
import { seoulToday } from './lib/time.ts';
import { useStore } from './ui/hooks.ts';
import { SheetProvider } from './ui/Sheet.tsx';
import { InstallBanner } from './ui/InstallCard.tsx';
import { ClientDetailPage, ClientsPage } from './pages/ClientsPage.tsx';
import { DriverHome } from './pages/DriverHome.tsx';
import { FleetPage } from './pages/FleetPage.tsx';
import { BlockedPage, LoginPage, NewPasswordSheet } from './pages/LoginPage.tsx';
import { OverviewPage } from './pages/OverviewPage.tsx';
import { OrderInputPage } from './pages/OrderInputPage.tsx';
import { ProductDetailPage } from './pages/ProductDetailPage.tsx';
import { RevenuePage } from './pages/RevenuePage.tsx';
import { AdminPage } from './pages/admin/AdminPage.tsx';
import { SchedulePage } from './pages/SchedulePage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>;
}

/** 마지막 작업 되돌리기 (화면 왼쪽 아래 · PC 는 Ctrl+Z) */
function UndoButton() {
  const n = useStore((s) => s.undoCount);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (document.querySelector('.sheet-backdrop, .modal-back')) return;
      e.preventDefault();
      store.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!n) return null;
  return <button className="undo-fab" onClick={() => store.undo()} title="마지막 작업 되돌리기 (Ctrl+Z)">↩ 되돌리기{n > 1 ? ` ${n}` : ''}</button>;
}

/** 배차 담당자가 일주일 지난 날짜를 볼 때: 보기만 가능 */
function LockBanner({ role }: { role: Role }) {
  const [params] = useSearchParams();
  const date = params.get('date');
  if (role !== 'dispatcher' || !date || date >= lockCutoff(seoulToday())) return null;
  return <div className="banner yellow" style={{ margin: 0, borderRadius: 0, textAlign: 'center' }}>🔒 {LOCK_DAYS}일 지난 일정입니다 — 보기만 가능 (수정은 관리자)</div>;
}

function StatusLine() {
  const online = useStore((s) => s.online);
  const pending = useStore((s) => s.pending);
  const snap = useStore((s) => s.snap);
  const role = useStore((s) => s.session?.role);
  const nav = useNavigate();
  if (isDemo) {
    if (role === 'viewer' || !backupOverdue(snap)) return null;
    return (
      <div className="banner yellow" style={{ margin: 0, borderRadius: 0, textAlign: 'center', cursor: 'pointer' }} onClick={() => nav('/settings')}>
        💾 데모 데이터는 이 기기에만 있습니다 — 백업 파일을 저장해 주세요 (설정 → 데이터 보관)
      </div>
    );
  }
  if (!online) return <div className="banner yellow" style={{ margin: 0, borderRadius: 0, textAlign: 'center' }}>오프라인 — 보기·입력 가능, 연결되면 자동 동기화 {pending ? `(대기 ${pending}건)` : ''}</div>;
  return null;
}

function TopMenu({ role }: { role: Role }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const loc = useLocation();
  const date = params.get('date') ?? seoulToday();
  const go = (d: string) => nav(`/?${new URLSearchParams({ ...Object.fromEntries(params), date: d })}`);
  return (
    <nav className="topmenu">
      <NavLink to="/" className="brand">경민물류</NavLink>
      {role !== 'viewer' ? (
        <>
          <NavLink to="/order">오더 입력</NavLink>
          <NavLink to="/clients">거래처 등록</NavLink>
          <NavLink to="/clients" onClick={(e) => { e.preventDefault(); nav('/clients'); }}>품목 등록</NavLink>
          <NavLink to="/fleet/vehicles">차량 등록</NavLink>
          <NavLink to="/fleet/drivers">기사 등록</NavLink>
          <NavLink to="/fleet/ships">선박 등록</NavLink>
          <span style={{ width: 16 }} />
          <button onClick={() => go(addDays(date, -1))}>◀ 전일</button>
          <NavLink to={loc.pathname === '/all' ? '/all' : menuUrl('/all')} onClick={(e) => { if (loc.pathname !== '/all') { e.preventDefault(); nav(menuUrl('/all')); } }}>전체 일정표</NavLink>
          <button onClick={() => go(addDays(date, 1))}>익일 ▶</button>
          <span style={{ width: 16 }} />
          <NavLink to={loc.pathname === '/' ? '/' : menuUrl('/')} end className={() => (loc.pathname === '/' ? 'active' : '')} onClick={(e) => { if (loc.pathname !== '/') { e.preventDefault(); nav(menuUrl('/')); } }}>배차</NavLink>
          {role === 'admin' && <NavLink to="/revenue">매출</NavLink>}
          <NavLink to={loc.pathname.startsWith('/admin') ? loc.pathname : '/admin/dispatch'} className={() => (loc.pathname.startsWith('/admin') ? 'active' : '')}>📊 관리</NavLink>
          {role === 'admin' ? <NavLink to="/settings">설정</NavLink> : <NavLink to="/settings">👤 내 계정</NavLink>}
        </>
      ) : (
        <>
          <NavLink to="/driver">내 배차</NavLink>
          <NavLink to="/settings">설정</NavLink>
        </>
      )}
    </nav>
  );
}

/** 화면 위치 기억: 주소(날짜·탭)는 메뉴별로, 스크롤은 화면별로. 앱을 다시 열면 마지막 화면으로 */
function NavMemory() {
  const loc = useLocation();
  const nav = useNavigate();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      const last = lastUrl();
      // 처음 열 때 주소가 기본 화면이면 마지막으로 보던 화면으로
      if (loc.pathname === '/' && !loc.search && last && last !== '/') {
        nav(last, { replace: true });
        return;
      }
    }
    remember(loc.pathname, loc.search);
    const key = loc.pathname + loc.search;
    const y = scrollOf(key);
    // 화면이 다 그려진 뒤에 한 번 더 (느린 휴대폰)
    const t = setTimeout(() => window.scrollTo(0, y), 60);
    const t2 = setTimeout(() => { if (Math.abs(window.scrollY - y) > 5 && lastY === y) window.scrollTo(0, y); }, 350);
    // 화면을 떠날 때는 이미 다음 화면으로 바뀌어 scrollY 가 0일 수 있으므로, 마지막으로 스크롤한 위치를 저장
    let lastY = y;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      // 다른 화면으로 넘어가는 순간의 스크롤(새 화면 높이에 맞춰 줄어듦)은 무시
      if (window.location.pathname + window.location.search !== key) return;
      lastY = window.scrollY;
      clearTimeout(timer);
      timer = setTimeout(() => saveScroll(key, lastY), 150);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
      saveScroll(key, lastY);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname, loc.search]);
  return null;
}

function TabBar({ role }: { role: Role }) {
  const loc = useLocation();
  const nav = useNavigate();
  if (role === 'viewer') return null;
  // 설정(매출 포함)은 관리자만. 관리 = 거래처·차량·기사·근무현황·선박·현장
  const tabs: [string, string, string][] = [
    ['/', '📋', '배차'], ['/all', '🗓', '일정표'], ['/order', '➕', '오더'], ['/clients', '🗂', '관리'],
    ...(role === 'admin' ? [['/settings', '⚙', '설정'] as [string, string, string]] : []),
  ];
  return (
    <nav className="tabbar">
      {tabs.map(([to, ic, l]) => (
        <NavLink key={to} to={menuOf(loc.pathname) === to ? to : menuUrl(to)} end={to === '/'} className={() => (menuOf(loc.pathname) === to ? 'active' : '')}
          // 주소는 누르는 순간 다시 계산 (방금 넘긴 배차·일정표 날짜까지 반영)
          onClick={(e) => { if (menuOf(loc.pathname) !== to) { e.preventDefault(); nav(menuUrl(to)); } }}>
          <span className="ic">{ic}</span>{l}
        </NavLink>
      ))}
    </nav>
  );
}

function Shell() {
  const session = useStore((s) => s.session);
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    if (!ready || !session || session.role === 'viewer') return;
    // 일주일마다 자동 이메일 백업 (설정돼 있을 때만)
    const t = setTimeout(() => {
      void autoWeeklyEmail(store.getState().snap).then((r) => {
        if (r === 'sent') store.toast('📧 주간 백업을 이메일로 보냈습니다');
        else if (r instanceof Error) store.toast(`주간 이메일 백업 실패: ${r.message}`, 'warn');
      });
    }, 3000);
    return () => clearTimeout(t);
  }, [ready, session]);
  if (!session) return null;
  if (!ready) return <div className="page"><p>불러오는 중…</p></div>;
  const viewer = session.role === 'viewer';
  return (
    <div className="app">
      <NavMemory />
      <TopMenu role={session.role} />
      <StatusLine />
      <LockBanner role={session.role} />
      <InstallBanner />
      {!viewer && <UndoButton />}
      {viewer ? (
        // 기사(조회) 계정: 내 배차만 (품목 주의사항·사진은 배차 카드에서 열림)
        <Routes>
          <Route path="/driver" element={<DriverHome />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/driver" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/" element={<SchedulePage />} />
          <Route path="/driver" element={<DriverHome />} />
          <Route path="/all" element={<OverviewPage />} />
          <Route path="/monthly" element={<Navigate to="/all" replace />} />
          <Route path="/order" element={<OrderInputPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:id" element={<ClientDetailPage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/fleet" element={<Navigate to="/fleet/vehicles" replace />} />
          <Route path="/fleet/maintenance" element={<Navigate to="/fleet/vehicles" replace />} />
          <Route path="/fleet/:tab" element={<FleetPage />} />
          {/* 매출은 관리자만: 배차 담당이 예전 주소로 들어오면 관리(거래처)로 */}
          <Route path="/revenue" element={session.role === 'admin' ? <RevenuePage /> : <Navigate to="/clients" replace />} />
          <Route path="/admin" element={<Navigate to="/admin/dispatch" replace />} />
          <Route path="/admin/:section" element={<AdminPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
      <TabBar role={session.role} />
    </div>
  );
}

export default function App() {
  const session = useStore((s) => s.session);
  const [checking, setChecking] = useState(!isDemo);
  const [blocked, setBlocked] = useState(false);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (isDemo) {
      const saved = localStorage.getItem('demo-role');
      if (saved) {
        const { role, driverId } = JSON.parse(saved);
        void store.start({ userId: 'demo', name: role === 'viewer' ? '기사(데모)' : '데모 사용자', role, driverId, demo: true });
      }
      return;
    }
    const startFor = async (userId: string | undefined) => {
      if (!userId) {
        await store.stop();
        setChecking(false);
        return;
      }
      let { data, error } = await supabase!.from('profiles').select('name,role,driver_id,blocked').eq('id', userId).single();
      // 회원 관리 SQL 적용 전 서버 (blocked 칸 없음)
      if (error) ({ data } = await supabase!.from('profiles').select('name,role,driver_id').eq('id', userId).single() as never);
      if ((data as { blocked?: boolean } | null)?.blocked) {
        await store.stop();
        setBlocked(true);
        setChecking(false);
        return;
      }
      setBlocked(false);
      await store.start({ userId, name: data?.name ?? '', role: (data?.role ?? 'viewer') as Role, driverId: data?.driver_id ?? null, demo: false });
      setChecking(false);
    };
    supabase!.auth.getSession().then(({ data }) => startFor(data.session?.user.id));
    const { data: sub } = supabase!.auth.onAuthStateChange((ev, s) => {
      if (ev === 'SIGNED_IN' && s?.user.id !== store.getState().session?.userId) void startFor(s?.user.id);
      if (ev === 'SIGNED_OUT') void startFor(undefined);
      if (ev === 'PASSWORD_RECOVERY') setRecovery(true); // 비밀번호 찾기 메일의 링크로 들어옴
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (checking) return <div className="page"><p>불러오는 중…</p></div>;
  return (
    <BrowserRouter>
      <SheetProvider>
        {recovery && <NewPasswordSheet close={() => setRecovery(false)} />}
        {blocked ? <BlockedPage /> : session ? <Shell /> : (
          <LoginPage onDemo={(role, driverId) => {
            localStorage.setItem('demo-role', JSON.stringify({ role, driverId }));
            void store.start({ userId: 'demo', name: role === 'viewer' ? '기사(데모)' : '데모 사용자', role, driverId, demo: true });
          }} />
        )}
        <Toasts />
      </SheetProvider>
    </BrowserRouter>
  );
}
