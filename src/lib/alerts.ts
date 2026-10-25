// 기사 일정 변경 알림: 소리 · 진동 (기기마다 기사님이 켜고 끔)
const SOUND = 'alert-sound';
const VIBRATE = 'alert-vibrate';

const read = (k: string) => { try { return localStorage.getItem(k) !== 'off'; } catch { return true; } };
const write = (k: string, on: boolean) => { try { localStorage.setItem(k, on ? 'on' : 'off'); } catch { /* 저장 안 돼도 이번만 */ } };

export const alertPrefs = () => ({ sound: read(SOUND), vibrate: read(VIBRATE) });
export const setAlertPref = (k: 'sound' | 'vibrate', on: boolean) => write(k === 'sound' ? SOUND : VIBRATE, on);
export const canVibrate = () => typeof navigator !== 'undefined' && 'vibrate' in navigator;

let ctx: AudioContext | null = null;
/** 브라우저는 화면을 한 번 누른 뒤에만 소리를 낼 수 있어, 첫 터치 때 소리 장치를 깨워 둔다 */
export function unlockAudio() {
  const wake = () => {
    try {
      ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      void ctx.resume();
    } catch { /* 소리 없는 기기 */ }
  };
  window.addEventListener('pointerdown', wake, { once: true });
  window.addEventListener('keydown', wake, { once: true });
}

/** 띵-동 두 번 */
function beep() {
  if (!ctx) return;
  const now = ctx.currentTime;
  [[880, 0], [660, 0.22], [880, 0.6], [660, 0.82]].forEach(([f, t]) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, now + t);
    g.gain.exponentialRampToValueAtTime(0.35, now + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.2);
    o.connect(g).connect(ctx!.destination);
    o.start(now + t);
    o.stop(now + t + 0.22);
  });
}

export const VIBRATE_PATTERN = [300, 120, 300, 120, 500];

/** 일정 변경 알림: 설정대로 소리·진동 + 휴대폰 알림창 */
export function ringAlert(message: string, force = false) {
  const p = alertPrefs();
  if (p.sound || force) beep();
  if ((p.vibrate || force) && canVibrate()) navigator.vibrate(VIBRATE_PATTERN);
  if (!force && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    void navigator.serviceWorker?.ready.then((r) => r.showNotification('경민물류 배차 변경', {
      body: message, tag: 'dispatch', silent: !p.sound,
      ...(p.vibrate ? { vibrate: VIBRATE_PATTERN, renotify: true } : {}),
    } as NotificationOptions));
  }
}
