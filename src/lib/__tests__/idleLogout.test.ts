import { beforeEach, describe, expect, it } from 'vitest';
import { IDLE_LIMIT_MS, idleExpired, markActive } from '../idleLogout.ts';

// 테스트 환경(node)에는 localStorage 가 없어서 간단히 흉내
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

describe('24시간 미사용 로그아웃 (기기별)', () => {
  beforeEach(() => mem.clear());
  const t0 = Date.UTC(2026, 10, 1, 0, 0, 0);

  it('기록이 없으면 지금부터 센다', () => {
    expect(idleExpired('u1', t0)).toBe(false);
    expect(idleExpired('u1', t0 + IDLE_LIMIT_MS - 1000)).toBe(false);
  });

  it('마지막 활동 뒤 24시간이 지나면 만료, 그 안에 쓰면 연장', () => {
    markActive('u1', t0);
    expect(idleExpired('u1', t0 + IDLE_LIMIT_MS + 1000)).toBe(true);
    markActive('u1', t0 + 20 * 3600e3);
    expect(idleExpired('u1', t0 + IDLE_LIMIT_MS + 1000)).toBe(false);
  });

  it('아이디마다 따로 (같은 기기의 다른 계정)', () => {
    markActive('u1', t0);
    markActive('u2', t0 + 23 * 3600e3);
    const later = t0 + IDLE_LIMIT_MS + 1000;
    expect(idleExpired('u1', later)).toBe(true);
    expect(idleExpired('u2', later)).toBe(false);
  });
});
