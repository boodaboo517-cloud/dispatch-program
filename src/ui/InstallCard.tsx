import { useEffect, useState } from 'react';
import { MANUAL_STEPS, browserKind, canPromptInstall, isStandalone, onInstallChange, promptInstall } from '../lib/install.ts';
import { store } from '../data/store.ts';
import { isDemo } from '../data/supabase.ts';
import { Sheet, useSheet } from './Sheet.tsx';

/** 설정 화면: 홈 화면에 앱 설치 */
export function InstallCard() {
  const [, force] = useState(0);
  useEffect(() => {
    const off = onInstallChange(() => force((n) => n + 1));
    return () => {
      off();
    };
  }, []);
  const standalone = isStandalone();
  const kind = browserKind();
  const install = async () => {
    const r = await promptInstall();
    if (r === 'accepted') store.toast('홈 화면에 설치했습니다. 이제 KM 아이콘으로 여세요');
  };
  return (
    <div className="card">
      <h3>📲 홈 화면에 앱 설치</h3>
      {standalone ? (
        <p className="small" style={{ color: 'var(--green)' }}>✓ 지금 홈 화면 앱으로 실행 중입니다.</p>
      ) : canPromptInstall() ? (
        <>
          <p className="small">버튼을 누르면 홈 화면에 KM 아이콘이 생기고, 주소창 없이 앱처럼 열립니다. 입력한 데이터는 그대로 이어집니다.</p>
          <button className="primary" style={{ width: '100%' }} onClick={install}>📲 홈 화면에 설치</button>
        </>
      ) : (
        <>
          <p className="small">이 브라우저에서는 메뉴로 설치합니다{kind === 'samsung' ? ' (삼성 인터넷)' : kind === 'chrome' ? ' (크롬)' : kind === 'ios' ? ' (아이폰 Safari)' : ''}:</p>
          <ol className="small" style={{ paddingLeft: 20, margin: '4px 0' }}>
            {MANUAL_STEPS[kind].map((s) => <li key={s} style={{ margin: '4px 0' }}>{s}</li>)}
          </ol>
          {isDemo && <p className="muted small">지금 쓰는 브라우저로 설치해야 입력한 데이터가 이어집니다. 설치 전에 💾 백업 파일 저장을 한 번 눌러 두세요.</p>}
        </>
      )}
    </div>
  );
}

const HIDE_KEY = 'install-banner-hidden';

/** 화면 위 설치 버튼: 홈 화면 앱으로 열면 사라지고, "나중에"를 누르면 7일 동안 숨김 */
export function InstallBanner() {
  const sheet = useSheet();
  const [, force] = useState(0);
  useEffect(() => {
    const off = onInstallChange(() => force((n) => n + 1));
    return () => {
      off();
    };
  }, []);
  let hiddenUntil = 0;
  try { hiddenUntil = Number(localStorage.getItem(HIDE_KEY) ?? 0); } catch { /* 저장 안 돼도 표시만 */ }
  if (isStandalone() || Date.now() < hiddenUntil) return null;
  const install = async () => {
    if (canPromptInstall()) {
      const r = await promptInstall();
      if (r === 'accepted') store.toast('홈 화면에 설치했습니다. 이제 KM 아이콘으로 여세요');
      return;
    }
    // 브라우저가 바로 설치를 지원하지 않으면 메뉴로 설치하는 방법 안내
    sheet.open((close) => (
      <Sheet title="홈 화면에 앱 설치" onClose={close} footer={<button className="primary" onClick={close}>확인</button>}>
        <InstallCard />
      </Sheet>
    ));
  };
  const later = () => {
    try { localStorage.setItem(HIDE_KEY, String(Date.now() + 7 * 86400000)); } catch { /* 무시 */ }
    force((n) => n + 1);
  };
  return (
    <div className="install-banner">
      <button className="primary grow" onClick={() => void install()}>📲 홈 화면에 앱 설치</button>
      <button className="ghost" onClick={later}>나중에</button>
    </div>
  );
}
