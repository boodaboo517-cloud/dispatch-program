import { useEffect, useState } from 'react';
import type { Role } from '../domain/index.ts';
import { isDemo, loginEmail, rememberLogin, supabase } from '../data/supabase.ts';
import { seedSnapshot } from '../data/seed.ts';
import { savedDemoData, store } from '../data/store.ts';
import { Seg } from '../ui/Picker.tsx';
import { InstallBanner } from '../ui/InstallCard.tsx';

export function LoginPage({ onDemo }: { onDemo: (role: Role, driverId: string | null) => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(rememberLogin.get());
  const [msg, setMsg] = useState('');
  const [driver, setDriver] = useState('');
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof savedDemoData>>>(null);
  const [hasData, setHasData] = useState(true);
  const drivers = (saved ?? seedSnapshot()).drivers.filter((d) => d.staff_type === '기사');
  const [kind, setKind] = useState<'base' | 'sample'>('base');
  useEffect(() => {
    if (isDemo) void savedDemoData().then((s) => { setSaved(s); setHasData(!!s); });
  }, []);
  const start = (role: Role, driverId: string | null) => {
    if (!hasData) localStorage.setItem('demo-data', kind);
    onDemo(role, driverId);
  };

  const submit = async () => {
    setMsg('');
    if (!email.trim() || !pw) return setMsg('아이디와 비밀번호를 넣어 주세요');
    rememberLogin.set(remember);
    const { error } = await supabase!.auth.signInWithPassword({ email: loginEmail(email), password: pw });
    if (!error) void store.logAccess('로그인');
    if (error) setMsg(/invalid/i.test(error.message) ? '아이디 또는 비밀번호가 맞지 않습니다' : /fetch|network/i.test(error.message) ? '서버에 연결하지 못했습니다 — 인터넷 연결을 확인하세요' : error.message);
  };

  return (
    <div className="page" style={{ maxWidth: 420, paddingTop: 48 }}>
      <h1 style={{ color: 'var(--red)', textAlign: 'center' }}>경민물류 배차</h1>
      <InstallBanner />
      {isDemo ? (
        <div className="card">
          <p><b>데모 모드</b> — 서버 없이 <b>이 기기에만</b> 저장됩니다. 설정 → 데이터 보관에서 백업 파일을 저장해 두면 나중에 서버로 그대로 옮길 수 있습니다.</p>
          {!hasData && (
            <div style={{ margin: '10px 0' }}>
              <div className="muted small" style={{ marginBottom: 4 }}>처음 시작할 데이터 — 실제로 쓰실 거면 "기본 명단만"</div>
              <Seg value={kind} onChange={setKind} options={[{ value: 'base', label: '기본 명단만' }, { value: 'sample', label: '예시 포함(연습)' }]} />
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="primary" onClick={() => start('admin', null)}>관리자로 시작</button>
            <button onClick={() => start('dispatcher', null)}>배차 담당으로 시작</button>
            <div className="row">
              <select value={driver} onChange={(e) => setDriver(e.target.value)}>
                <option value="">기사 선택</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button onClick={() => start('viewer', driver || drivers[0]?.id || null)}>기사로 시작</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <label className="field"><span>아이디</span><input autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span>비밀번호</span><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} /></label>
          <label className="row" style={{ gap: 8, margin: '4px 0 10px' }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: 22, height: 22 }} />
            <span>로그인 상태 유지 <span className="muted small">(공용 PC면 끄세요)</span></span>
          </label>
          {msg && <div className="banner red">{msg}</div>}
          <button className="primary" style={{ width: '100%' }} onClick={() => void submit()}>로그인</button>
          <p className="muted small">계정은 관리자가 [사용자 관리]에서 만들어 줍니다. 비밀번호를 잊으면 관리자에게 초기화를 부탁하세요. 예전 이메일 계정은 이메일을 그대로 넣어도 됩니다.</p>
        </div>
      )}
    </div>
  );
}

/** 막힌(퇴사) 계정 */
export function BlockedPage() {
  return (
    <div className="page" style={{ maxWidth: 420, paddingTop: 48 }}>
      <h1 style={{ color: 'var(--red)', textAlign: 'center' }}>경민물류 배차</h1>
      <div className="card">
        <p><b>사용이 중지된 계정입니다.</b></p>
        <p className="muted small">다시 사용하려면 관리자에게 문의하세요.</p>
        <button style={{ width: '100%' }} onClick={() => void supabase!.auth.signOut().then(() => location.reload())}>로그아웃</button>
      </div>
    </div>
  );
}

/** 비밀번호 찾기 메일의 링크로 들어왔을 때 · 설정에서 비밀번호 바꾸기 */
export function NewPasswordSheet({ close }: { close: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const save = async () => {
    if (pw.length < 6) return setMsg('6자 이상으로 정해 주세요');
    if (pw !== pw2) return setMsg('두 번 넣은 비밀번호가 다릅니다');
    const { error } = await supabase!.auth.updateUser({ password: pw });
    if (error) return setMsg(error.message);
    alert('비밀번호를 바꿨습니다');
    close();
  };
  return (
    <div className="modal-back">
      <div className="card" style={{ maxWidth: 400, margin: '15vh auto 0' }}>
        <h3>새 비밀번호 정하기</h3>
        <label className="field"><span>새 비밀번호 (6자 이상)</span><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label className="field"><span>한 번 더</span><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} /></label>
        {msg && <div className="banner red">{msg}</div>}
        <div className="row" style={{ gap: 6 }}>
          <button className="grow" onClick={close}>닫기</button>
          <button className="primary grow" onClick={() => void save()}>저장</button>
        </div>
      </div>
    </div>
  );
}
