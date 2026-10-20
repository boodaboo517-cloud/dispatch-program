import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, type Role } from './domain/index.ts';
import { backupOverdue } from './data/backup.ts';
import { autoWeeklyEmail } from './data/emailBackup.ts';
import { store } from './data/store.ts';
import { isDemo, supabase } from './data/supabase.ts';
import { seoulToday } from './lib/time.ts';
import { useStore } from './ui/hooks.ts';
import { SheetProvider } from './ui/Sheet.tsx';
import { ClientDetailPage, ClientsPage } from './pages/ClientsPage.tsx';
import { DriverHome } from './pages/DriverHome.tsx';
import { FleetPage } from './pages/FleetPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { MonthlyPage } from './pages/MonthlyPage.tsx';
import { OrderInputPage } from './pages/OrderInputPage.tsx';
import { ProductDetailPage } from './pages/ProductDetailPage.tsx';
import { RevenuePage } from './pages/RevenuePage.tsx';
import { SchedulePage } from './pages/SchedulePage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>;
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
          <span style={{ width: 16 }} />
          <button onClick={() => go(addDays(date, -1))}>◀ 전일</button>
          <NavLink to="/monthly">월별 일정</NavLink>
          <button onClick={() => go(addDays(date, 1))}>익일 ▶</button>
          <span style={{ width: 16 }} />
          <NavLink to="/" end className={() => (loc.pathname === '/' ? 'active' : '')}>일정표</NavLink>
          <NavLink to="/fleet/maintenance">정비</NavLink>
          <NavLink to="/revenue">매출</NavLink>
          <NavLink to="/settings">설정</NavLink>
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

function TabBar({ role }: { role: Role }) {
  if (role === 'viewer') return null;
  const tabs: [string, string, string][] = [
    ['/', '📋', '일정표'], ['/monthly', '📅', '월별'], ['/order', '➕', '오더'], ['/clients', '🏢', '거래처'], ['/settings', '🚚', '차량·설정'],
  ];
  return (
    <nav className="tabbar">
      {tabs.map(([to, ic, l]) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
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
      <TopMenu role={session.role} />
      <StatusLine />
      <Routes>
        <Route path="/" element={viewer ? <Navigate to="/driver" replace /> : <SchedulePage />} />
        <Route path="/driver" element={<DriverHome />} />
        <Route path="/monthly" element={<MonthlyPage />} />
        <Route path="/order" element={viewer ? <Navigate to="/driver" /> : <OrderInputPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/:id" element={<ClientDetailPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/fleet" element={<Navigate to="/fleet/vehicles" replace />} />
        <Route path="/fleet/:tab" element={<FleetPage />} />
        <Route path="/revenue" element={<RevenuePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TabBar role={session.role} />
    </div>
  );
}

export default function App() {
  const session = useStore((s) => s.session);
  const [checking, setChecking] = useState(!isDemo);

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
      const { data } = await supabase!.from('profiles').select('name,role,driver_id').eq('id', userId).single();
      await store.start({ userId, name: data?.name ?? '', role: (data?.role ?? 'viewer') as Role, driverId: data?.driver_id ?? null, demo: false });
      setChecking(false);
    };
    supabase!.auth.getSession().then(({ data }) => startFor(data.session?.user.id));
    const { data: sub } = supabase!.auth.onAuthStateChange((ev, s) => {
      if (ev === 'SIGNED_IN' && s?.user.id !== store.getState().session?.userId) void startFor(s?.user.id);
      if (ev === 'SIGNED_OUT') void startFor(undefined);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (checking) return <div className="page"><p>불러오는 중…</p></div>;
  return (
    <BrowserRouter>
      <SheetProvider>
        {session ? <Shell /> : (
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
