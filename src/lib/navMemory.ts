// 메뉴를 오갈 때 마지막 보던 화면(날짜·탭·스크롤)에서 다시 시작하고, 앱을 다시 열면 마지막 메뉴로.
import { seoulToday } from './time.ts';

/** 아래 탭(메뉴) 묶음: 그 메뉴 안에서 마지막으로 본 화면으로 돌아간다 */
export function menuOf(pathname: string): string {
  if (pathname === '/') return '/';
  if (pathname.startsWith('/all')) return '/all';
  if (pathname.startsWith('/order')) return '/order';
  if (pathname.startsWith('/clients') || pathname.startsWith('/products') || pathname.startsWith('/fleet') || pathname.startsWith('/revenue')) return '/clients';
  if (pathname.startsWith('/settings')) return '/settings';
  if (pathname.startsWith('/driver')) return '/driver';
  return pathname;
}

const KEY = 'nav-memory';
type Memory = { day: string; last: string; menus: Record<string, string>; scroll: Record<string, number> };

function load(): Memory {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? '') as Memory;
    if (m && typeof m === 'object' && m.menus) return { ...m, scroll: m.scroll ?? {} };
  } catch {
    // 처음이거나 손상됨
  }
  return { day: seoulToday(), last: '', menus: {}, scroll: {} };
}

let mem = load();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(mem));
  } catch {
    // 저장 공간 문제는 무시
  }
};

/** 다른 날 다시 열면 지난 날짜(date=) 는 버리고 오늘로 */
function fresh(url: string): string {
  if (mem.day === seoulToday()) return url;
  const [path, q = ''] = url.split('?');
  const p = new URLSearchParams(q);
  p.delete('date');
  p.delete('focus');
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

export function remember(pathname: string, search: string) {
  const url = pathname + search.replace(/[?&]r=\d+/, '');
  mem = { ...mem, day: seoulToday(), last: url, menus: { ...mem.menus, [menuOf(pathname)]: url } };
  save();
}

/** 메뉴 링크 주소: 그 메뉴에서 마지막으로 본 화면 (없으면 기본) */
export const menuUrl = (menu: string) => fresh(mem.menus[menu] ?? menu);

/** 앱을 다시 열었을 때 갈 화면 */
export const lastUrl = () => (mem.last ? fresh(mem.last) : '');

export function saveScroll(key: string, y: number) {
  delete mem.scroll[key];
  mem.scroll[key] = Math.round(y);
  const keys = Object.keys(mem.scroll);
  for (const k of keys.slice(0, Math.max(0, keys.length - 40))) delete mem.scroll[k]; // 최근 40개 화면만
  save();
}
export const scrollOf = (key: string) => mem.scroll[key] ?? 0;
