// 홈 화면 설치(PWA): 브라우저가 주는 설치 이벤트를 앱 시작 때 잡아 두었다가 버튼으로 띄운다
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function initInstallCapture() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // 브라우저 기본 안내 대신 앱 안 버튼으로
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
}

export const onInstallChange = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const canPromptInstall = () => !!deferred;

/** 홈 화면 앱(주소창 없는 화면)으로 실행 중인지 */
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  emit();
  return outcome;
}

export type BrowserKind = 'samsung' | 'chrome' | 'ios' | 'other';
export function browserKind(ua = navigator.userAgent): BrowserKind {
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Chrome|CriOS/i.test(ua)) return 'chrome';
  return 'other';
}

export const MANUAL_STEPS: Record<BrowserKind, string[]> = {
  samsung: [
    '화면을 맨 위로 올리거나 살짝 아래로 끌어 주소창과 아래 메뉴가 보이게 합니다.',
    '주소창 오른쪽 ⬇(설치) 아이콘이 보이면 누릅니다.',
    '없으면 맨 아래 ≡ 메뉴 → "페이지 추가" → "홈 화면"을 누릅니다.',
  ],
  chrome: ['주소창 오른쪽 ⋮ 메뉴를 누릅니다.', '"앱 설치" 또는 "홈 화면에 추가"를 누릅니다.'],
  ios: ['Safari 아래 공유 버튼(□↑)을 누릅니다.', '"홈 화면에 추가"를 누릅니다.'],
  other: ['브라우저 메뉴에서 "홈 화면에 추가" 또는 "앱 설치"를 찾아 누릅니다.'],
};
