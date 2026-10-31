import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * 로그인 상태 유지: 켜면 이 기기에 계속(localStorage), 끄면 창을 닫을 때까지만(sessionStorage).
 * 로그인할 때 고른 값을 기억해 두고, 그에 맞는 저장소에 로그인 정보를 둔다.
 */
const REMEMBER = 'login-remember';
export const rememberLogin = {
  get: () => { try { return localStorage.getItem(REMEMBER) !== '0'; } catch { return true; } },
  set: (on: boolean) => { try { localStorage.setItem(REMEMBER, on ? '1' : '0'); } catch { /* 저장 못 하면 기본(유지) */ } },
};
const authStorage = {
  getItem: (k: string) => {
    try { return (rememberLogin.get() ? localStorage : sessionStorage).getItem(k); } catch { return null; }
  },
  setItem: (k: string, v: string) => {
    try {
      const keep = rememberLogin.get();
      (keep ? localStorage : sessionStorage).setItem(k, v);
      (keep ? sessionStorage : localStorage).removeItem(k);
    } catch { /* 무시 */ }
  },
  removeItem: (k: string) => {
    try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* 무시 */ }
  },
};

/** 환경변수가 없으면 null → 데모 모드(이 기기에만 저장) */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { storage: authStorage, persistSession: true } }) : null;
export const isDemo = !supabase;

/** 창을 닫는 순간 보낼 기록용: 마지막 로그인 토큰 (비동기로 다시 읽을 시간이 없음) */
let accessToken = '';
supabase?.auth.onAuthStateChange((_e, s) => { accessToken = s?.access_token ?? ''; });

/** 창을 닫을 때도 끝까지 보내지는 RPC 호출 (keepalive) */
export function rpcOnClose(fn: string, body: Record<string, unknown>) {
  if (!url || !key || !accessToken) return;
  void fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST', keepalive: true,
    headers: { apikey: key, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

/** 로그인 아이디 → 로그인용 이메일 ("@" 가 있으면 예전 이메일 계정 그대로) */
export const loginEmail = (id: string) => {
  const v = id.trim().toLowerCase();
  return v.includes('@') ? v : `${v}@gm.local`;
};
/** 화면에 보일 아이디 (내부 이메일 hong@gm.local → hong) */
export const loginIdOf = (email: string | null | undefined) => (email ?? '').replace(/@gm\.local$/, '');
