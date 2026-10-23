import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';
import { initInstallCapture } from './lib/install.ts';
import './styles.css';

registerSW({
  immediate: true,
  // 휴대폰에서 앱을 켜 둔 채로 쓰면 업데이트를 늦게 받으므로: 다시 볼 때마다, 그리고 15분마다 새 버전 확인
  onRegisteredSW(_url, r) {
    if (!r) return;
    const check = () => void r.update().catch(() => undefined);
    setInterval(check, 15 * 60 * 1000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  },
});
initInstallCapture();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// 화면이 정상으로 떴다는 표시 (index.html 의 흰 화면 감시용)
(window as unknown as { __appStarted?: boolean }).__appStarted = true;
