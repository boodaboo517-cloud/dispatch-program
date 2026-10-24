import { useEffect, useState } from 'react';
import type { Role } from '../domain/index.ts';
import { isDemo, supabase } from '../data/supabase.ts';
import { seedSnapshot } from '../data/seed.ts';
import { savedDemoData } from '../data/store.ts';
import { Seg } from '../ui/Picker.tsx';
import { InstallBanner } from '../ui/InstallCard.tsx';

export function LoginPage({ onDemo }: { onDemo: (role: Role, driverId: string | null) => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
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

  const sendReset = async () => {
    setMsg('');
    if (!email.trim()) return setMsg('가입한 이메일을 넣어 주세요');
    const { error } = await supabase!.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setMsg(error ? error.message : '비밀번호를 다시 정하는 링크를 메일로 보냈습니다. 메일이 오지 않으면 관리자에게 "비밀번호 재설정"을 부탁하세요.');
  };

  const submit = async () => {
    setMsg('');
    if (mode === 'reset') return sendReset();
    const r = mode === 'login'
      ? await supabase!.auth.signInWithPassword({ email, password: pw })
      : await supabase!.auth.signUp({ email, password: pw, options: { data: { name } } });
    if (r.error) setMsg(r.error.message);
    else if (mode === 'signup' && !r.data.session) setMsg('가입 확인 메일을 확인하세요.');
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
          {mode === 'signup' && <label className="field"><span>이름</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>}
          <label className="field"><span>이메일</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {mode !== 'reset' && <label className="field"><span>비밀번호</span><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>}
          {mode === 'reset' && <p className="muted small">가입한 이메일로 비밀번호를 다시 정하는 링크를 보냅니다.</p>}
          {msg && <div className={`banner ${mode === 'reset' && msg.startsWith('비밀번호를') ? 'blue' : 'red'}`}>{msg}</div>}
          <button className="primary" style={{ width: '100%' }} onClick={submit}>{mode === 'login' ? '로그인' : mode === 'signup' ? '가입' : '재설정 메일 보내기'}</button>
          <button className="ghost" style={{ width: '100%' }} onClick={() => { setMsg(''); setMode(mode === 'login' ? 'signup' : 'login'); }}>{mode === 'login' ? '처음이세요? 가입' : '로그인으로'}</button>
          {mode === 'login' && <button className="ghost" style={{ width: '100%' }} onClick={() => { setMsg(''); setMode('reset'); }}>비밀번호를 잊으셨나요?</button>}
          <p className="muted small">처음 가입한 사람이 관리자가 됩니다. 이후 가입자는 조회(기사) 권한이며, 관리자가 설정에서 바꿉니다.</p>
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
