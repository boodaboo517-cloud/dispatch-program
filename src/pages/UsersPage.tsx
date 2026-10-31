// 사용자 관리 (관리자만): 아이디 만들기 · 아이디 지정 · 비활성화 · 비밀번호 초기화 · 권한
import { useEffect, useState } from 'react';
import type { Role } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { loginIdOf, supabase } from '../data/supabase.ts';
import { TZ, dayjs } from '../lib/time.ts';
import { useSnap, useStore } from '../ui/hooks.ts';
import { Sheet, useSheet } from '../ui/Sheet.tsx';
import { ProfileSheet } from './ProfileSheet.tsx';

export const ROLE_LABEL: Record<Role, string> = { admin: '관리자', dispatcher: '일반(배차)', viewer: '조회(기사)' };
const needSql = (m: string) => (/function .* does not exist|Could not find the function/i.test(m) ? '서버에 이번 업데이트 SQL(update_20261101.sql)을 먼저 실행해 주세요' : m);

type UserRow = { id: string; name: string; role: Role; driver_id: string | null; blocked?: boolean; phone?: string; login_id?: string | null; email?: string; created_at?: string; last_sign_in_at?: string | null };

export function UsersPage() {
  const snap = useSnap();
  const sheet = useSheet();
  const me = useStore((s) => s.session?.userId);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [noInfo, setNoInfo] = useState(false);
  const load = async () => {
    if (!supabase) return;
    const [first, info] = await Promise.all([
      supabase.from('profiles').select('id,name,role,driver_id,blocked,phone,login_id'),
      supabase.rpc('admin_users'),
    ]);
    // 회원 정보 SQL 전이면 연락처 없이
    const profiles = first.error ? (await supabase.from('profiles').select('id,name,role,driver_id,blocked')).data : first.data;
    // 서버에 회원 관리 SQL(20261025000018)을 아직 안 넣었으면 이메일·가입일 없이 보여 준다
    setNoInfo(!!info.error);
    const byId = new Map(((info.data ?? []) as { id: string; email: string; created_at: string; last_sign_in_at: string | null }[]).map((u) => [u.id, u]));
    const rows = ((profiles ?? []) as UserRow[]).map((p) => ({ ...p, ...byId.get(p.id) }));
    rows.sort((a, b) => Number(!!a.blocked) - Number(!!b.blocked) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
    setUsers(rows);
  };
  useEffect(() => {
    void load();
  }, []);
  const update = async (id: string, p: Record<string, unknown>) => {
    const { error } = await supabase!.from('profiles').update(p).eq('id', id);
    if (error) store.toast(error.message, 'error');
    void load();
  };
  const activeAdmins = users.filter((u) => u.role === 'admin' && !u.blocked).length;
  const block = async (u: UserRow) => {
    if (!u.blocked) {
      if (u.id === me) return store.toast('내 계정은 막을 수 없습니다', 'error');
      if (u.role === 'admin' && activeAdmins <= 1) return store.toast('관리자가 한 명은 남아 있어야 합니다', 'error');
      const ok = await sheet.confirm({
        title: `${u.name} 계정 비활성화`,
        message: '퇴사 등으로 계정을 막습니다. 로그인해도 아무 데이터도 볼 수 없고 입력도 못 합니다. 입력했던 배차·오더는 그대로 남고, 나중에 다시 허용할 수 있습니다.',
        actions: [{ label: '비활성화', value: 'y', kind: 'danger' }],
      });
      if (!ok) return;
    }
    await update(u.id, { blocked: !u.blocked });
    store.toast(u.blocked ? `${u.name} 계정을 다시 쓸 수 있게 했습니다` : `${u.name} 계정을 비활성화했습니다`);
  };
  const resetPw = (u: UserRow) => sheet.open((close) => <PasswordResetSheet user={u} close={close} />);
  const day = (t?: string | null) => (t ? dayjs(t).tz(TZ).format('YYYY.M.D') : '-');
  const create = () => sheet.open((close) => <CreateUserSheet close={close} onDone={() => void load()} />);
  const setId = (u: UserRow) => sheet.open((close) => <LoginIdSheet user={u} close={close} onDone={() => void load()} />);
  return (
    <div className="page">
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>👥 사용자 관리</h3>
        <button className="primary" onClick={create}>＋ 아이디 만들기</button>
      </div>
      <p className="muted small">일반(배차)은 배차·오더·등록을 모두 하고 사용자 관리만 못 합니다. 조회(기사) 계정은 연결된 기사의 배차만 "내 배차"에 보입니다.</p>
      {noInfo && <div className="banner yellow small">이메일·가입일·막기·비밀번호 재설정을 쓰려면 Supabase에 회원 관리 SQL을 한 번 실행해야 합니다.</div>}
      {users.map((u) => (
        <div key={u.id} className="user-row" style={{ opacity: u.blocked ? 0.55 : 1 }}>
          <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
            <b>{u.name || '(이름 없음)'}</b>
            {u.login_id ? <span className="badge">{u.login_id}</span> : <button className="chip" onClick={() => setId(u)}>아이디 지정</button>}
            {u.blocked && <span className="mk warn">비활성</span>}
            {u.id === me && <span className="muted small">나</span>}
          </div>
          {u.email !== undefined && <div className="muted small">{u.email && !u.email.endsWith('@gm.local') ? `${u.email} · ` : ''}{u.phone ? `${u.phone} · ` : ''}만든 날 {day(u.created_at)} · 최근 로그인 {day(u.last_sign_in_at)}</div>}
          <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
            <select style={{ width: 120 }} value={u.role} disabled={u.blocked} onChange={(e) => {
              if (u.role === 'admin' && e.target.value !== 'admin' && activeAdmins <= 1) { store.toast('관리자가 한 명은 남아 있어야 합니다', 'error'); return; }
              void update(u.id, { role: e.target.value });
            }}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <select style={{ width: 140 }} value={u.driver_id ?? ''} disabled={u.blocked} onChange={(e) => update(u.id, { driver_id: e.target.value || null })}>
              <option value="">기사 연결 없음</option>{snap.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button className="chip" onClick={() => sheet.open((close) => <ProfileSheet userId={u.id} email={u.email} self={u.id === me} close={close} onSaved={() => void load()} />)}>✏ 정보</button>
            {!noInfo && <button className="chip" onClick={() => resetPw(u)}>🔑 비밀번호 초기화</button>}
            {u.login_id && <button className="chip" onClick={() => setId(u)}>아이디 변경</button>}
            {!noInfo && u.id !== me && <button className={`chip ${u.blocked ? '' : 'danger'}`} onClick={() => void block(u)}>{u.blocked ? '다시 사용' : '🚫 비활성화'}</button>}
          </div>
        </div>
      ))}
    </div>
    </div>
  );
}

/** 관리자가 새 비밀번호를 정해 직접 알려 준다 (메일 없이) */
function PasswordResetSheet({ user, close }: { user: UserRow; close: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase!.rpc('admin_set_password', { target: user.id, new_password: pw });
    setBusy(false);
    if (error) return store.toast(needSql(error.message), 'error');
    store.toast(`${user.name} 비밀번호를 바꿨습니다. 새 비밀번호를 본인에게 알려 주세요`);
    close();
  };
  return (
    <Sheet title={`${user.name} 비밀번호 초기화`} onClose={close} footer={<button className="primary" disabled={busy || pw.length < 6} onClick={() => void save()}>바꾸기</button>}>
      <p className="muted small">{user.login_id || loginIdOf(user.email)} 계정의 비밀번호를 새로 정합니다. 바꾼 뒤 본인에게 알려 주고, 로그인한 다음 설정에서 다시 바꾸게 하세요.</p>
      <label className="field"><span>새 비밀번호 (6자 이상)</span><input type="text" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
    </Sheet>
  );
}

function CreateUserSheet({ close, onDone }: { close: () => void; onDone: () => void }) {
  const [id, setIdv] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [role, setRole] = useState<Role>('dispatcher');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase!.rpc('admin_create_user', { p_login: id.trim().toLowerCase(), p_name: name.trim(), p_password: pw, p_role: role });
    setBusy(false);
    if (error) return store.toast(needSql(error.message), 'error');
    store.toast(`아이디 ${id.trim().toLowerCase()} 를 만들었습니다. 아이디·비밀번호를 본인에게 알려 주세요`);
    onDone();
    close();
  };
  return (
    <Sheet title="아이디 만들기" onClose={close} footer={<button className="primary" disabled={busy || id.trim().length < 2 || pw.length < 6} onClick={() => void save()}>만들기</button>}>
      <label className="field"><span>아이디 (영문 소문자·숫자, 2자 이상)</span><input autoCapitalize="none" autoCorrect="off" spellCheck={false} value={id} onChange={(e) => setIdv(e.target.value)} placeholder="예: hong" /></label>
      <label className="field"><span>이름</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 홍길동" /></label>
      <label className="field"><span>처음 비밀번호 (6자 이상)</span><input type="text" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <label className="field"><span>권한</span>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </label>
    </Sheet>
  );
}

/** 예전 이메일 계정에 아이디 붙이기 · 아이디 바꾸기 (그 뒤로는 아이디로 로그인) */
function LoginIdSheet({ user, close, onDone }: { user: UserRow; close: () => void; onDone: () => void }) {
  const [id, setIdv] = useState(user.login_id ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase!.rpc('admin_set_login_id', { target: user.id, p_login: id.trim().toLowerCase() });
    setBusy(false);
    if (error) return store.toast(needSql(error.message), 'error');
    store.toast(`${user.name} 아이디를 ${id.trim().toLowerCase()} 로 정했습니다. 이제 이 아이디로 로그인합니다`);
    onDone();
    close();
  };
  return (
    <Sheet title={`${user.name} 아이디`} onClose={close} footer={<button className="primary" disabled={busy || id.trim().length < 2} onClick={() => void save()}>저장</button>}>
      <p className="muted small">정한 뒤에는 이메일 대신 <b>아이디 + 기존 비밀번호</b>로 로그인합니다. 본인에게 알려 주세요.</p>
      <label className="field"><span>아이디 (영문 소문자·숫자, 2자 이상)</span><input autoCapitalize="none" autoCorrect="off" spellCheck={false} value={id} onChange={(e) => setIdv(e.target.value)} /></label>
    </Sheet>
  );
}
