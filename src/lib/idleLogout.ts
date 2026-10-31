// 24시간 동안 아무 활동(누르기·입력·스크롤)이 없으면 이 기기만 로그아웃.
// 마지막 활동 시각은 기기(브라우저)마다 따로 저장하므로 PC·폰이 서로 영향을 주지 않는다.
export const IDLE_LIMIT_MS = 24 * 60 * 60 * 1000;
const KEY = 'last-activity';
const NOTICE = 'idle-logout-notice';

const read = (userId: string): number | null => {
  try {
    const v = localStorage.getItem(`${KEY}:${userId}`);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
};

export function markActive(userId: string, now = Date.now()) {
  try { localStorage.setItem(`${KEY}:${userId}`, String(now)); } catch { /* 저장 못 하면 검사 안 함 */ }
}

/** 마지막 활동 뒤 24시간이 지났는지 (기록이 없으면 지금부터 셈) */
export function idleExpired(userId: string, now = Date.now()): boolean {
  const last = read(userId);
  if (last == null) {
    markActive(userId, now);
    return false;
  }
  return now - last > IDLE_LIMIT_MS;
}

/** 로그인 화면에 한 번 보여 줄 안내 */
export const idleNotice = {
  set: () => { try { sessionStorage.setItem(NOTICE, '1'); } catch { /* 무시 */ } },
  take: () => {
    try {
      const v = sessionStorage.getItem(NOTICE);
      sessionStorage.removeItem(NOTICE);
      return !!v;
    } catch {
      return false;
    }
  },
};

/**
 * 활동 감시 시작: 사용자가 화면을 쓰면 시각을 갱신(1분에 한 번만 저장)하고,
 * 1분마다 · 화면으로 돌아올 때 24시간 지났는지 확인해서 onExpire 를 부른다.
 */
export function watchIdle(userId: string, onExpire: () => void): () => void {
  let lastSaved = 0;
  const active = () => {
    const now = Date.now();
    if (now - lastSaved < 60 * 1000) return;
    // 잠들어 있던 기기를 다시 켠 첫 손길은 활동으로 치기 전에 먼저 만료 확인
    if (idleExpired(userId, now)) return onExpire();
    lastSaved = now;
    markActive(userId, now);
  };
  const check = () => { if (idleExpired(userId)) onExpire(); };
  const onVisible = () => { if (document.visibilityState === 'visible') check(); };
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
  for (const e of events) window.addEventListener(e, active, { passive: true, capture: true });
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(check, 60 * 1000);
  return () => {
    for (const e of events) window.removeEventListener(e, active, { capture: true });
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}
