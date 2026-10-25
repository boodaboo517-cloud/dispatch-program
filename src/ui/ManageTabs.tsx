// 거래처 메뉴 위 탭: 거래처 · 차량 · 기사 · 근무현황 · 선박 · 현장 · 매출 (휴대폰은 좌우로 밀어도 이동)
import { useLocation, useNavigate } from 'react-router-dom';
import { useIsWide, useRole } from './hooks.ts';
import { useSwipe } from './useSwipe.ts';

export const MANAGE_TABS: [string, string][] = [
  ['/clients', '거래처'], ['/fleet/vehicles', '차량'], ['/fleet/drivers', '기사'], ['/fleet/attendance', '근무현황'],
  ['/fleet/ships', '선박'], ['/fleet/field', '현장'], ['/revenue', '매출'],
];

function useTabs() {
  const { staff } = useRole();
  return MANAGE_TABS.filter(([to]) => staff || to !== '/revenue');
}

const indexOf = (tabs: [string, string][], path: string) => tabs.findIndex(([to]) => path === to || path.startsWith(`${to}/`));

export function ManageTabs() {
  const loc = useLocation();
  const nav = useNavigate();
  const tabs = useTabs();
  const cur = indexOf(tabs, loc.pathname);
  return (
    <div className="tabs manage-tabs">
      {tabs.map(([to, l], i) => <button key={to} className={i === cur ? 'on' : ''} onClick={() => nav(to, { replace: true })}>{l}</button>)}
    </div>
  );
}

/** 휴대폰: 좌우로 밀어 옆 탭으로 */
export function useManageSwipe() {
  const loc = useLocation();
  const nav = useNavigate();
  const wide = useIsWide();
  const tabs = useTabs();
  const swipe = useSwipe((dir) => {
    const next = tabs[indexOf(tabs, loc.pathname) + dir];
    if (next) { nav(next[0], { replace: true }); window.scrollTo({ top: 0 }); }
  });
  return wide ? {} : swipe;
}
