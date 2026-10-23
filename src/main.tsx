import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';
import { initInstallCapture } from './lib/install.ts';
import './styles.css';

registerSW({ immediate: true });
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
