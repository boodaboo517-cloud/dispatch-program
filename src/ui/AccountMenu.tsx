// 내 계정 메뉴: 화면 위 오른쪽 "👤 아이디" → 내 정보 · 비밀번호 · 이 기기에서 로그아웃
import { useNavigate } from 'react-router-dom';
import { store } from '../data/store.ts';
import { isDemo, supabase } from '../data/supabase.ts';
import { useStore } from './hooks.ts';
import { Sheet, useSheet } from './Sheet.tsx';

const ROLE: Record<string, string> = { admin: '관리자', dispatcher: '일반(배차)', viewer: '조회(기사)' };

/** 이 기기에서만 로그아웃 (다른 기기 로그인은 그대로) */
export async function logoutThisDevice() {
  await store.logAccess('로그아웃').catch(() => undefined);
  await supabase?.auth.signOut({ scope: 'local' });
  await store.stop();
  localStorage.removeItem('demo-role');
  location.href = '/';
}

export function AccountChip() {
  const session = useStore((s) => s.session);
  const sheet = useSheet();
  if (!session) return null;
  const label = session.loginId || session.name || '내 계정';
  return (
    <button className="account-chip" onClick={() => sheet.open((close) => <AccountSheet close={close} />)} title="내 계정 · 로그아웃">
      👤 {label}
    </button>
  );
}

function AccountSheet({ close }: { close: () => void }) {
  const session = useStore((s) => s.session);
  const nav = useNavigate();
  if (!session) return null;
  return (
    <Sheet title="내 계정" onClose={close}>
      <p>
        <b>{session.name}</b>{session.loginId ? <span className="muted"> ({session.loginId})</span> : null} · {ROLE[session.role] ?? session.role}
        {isDemo && <span className="badge warn"> 데모</span>}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={() => { close(); nav('/settings'); }}>⚙ 내 정보 · 비밀번호 · 설정</button>
        <button className="danger" onClick={() => void logoutThisDevice()}>🚪 로그아웃 (이 기기)</button>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>로그아웃은 지금 쓰는 기기에만 적용됩니다. 다른 PC·폰의 로그인은 그대로입니다.</p>
    </Sheet>
  );
}
