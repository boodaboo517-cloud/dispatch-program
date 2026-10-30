import { describe, expect, it } from 'vitest';
import { applyMutations } from '../tx.ts';
import { emptySnapshot, type Mutation, type Snapshot } from '../types.ts';
import { inverseMutations, lockCutoff, lockedMutations } from '../undo.ts';

const snapWith = (rows: Record<string, unknown>[]): Snapshot =>
  ({ ...emptySnapshot(), daily_orders: rows }) as unknown as Snapshot;

describe('되돌리기', () => {
  const a = { id: 'a', date: '2026-10-30', memo: '처음', updated_at: 't0' };
  const b = { id: 'b', date: '2026-10-30', memo: '지울 것' };
  const snap = snapWith([a, b]);
  const muts: Mutation[] = [
    { table: 'daily_orders', op: 'upsert', row: { ...a, memo: '고침' } },
    { table: 'daily_orders', op: 'upsert', row: { ...a, memo: '또 고침' } },
    { table: 'daily_orders', op: 'delete', id: 'b' },
    { table: 'daily_orders', op: 'upsert', row: { id: 'c', date: '2026-10-30', memo: '새로' } },
  ];
  it('고친 줄은 처음 값으로, 지운 줄은 다시, 새 줄은 지우기', () => {
    const after = applyMutations(snap, muts);
    const inv = inverseMutations(snap, muts, { at: 't9', by: 'u1' });
    expect(inv).toHaveLength(3);
    const back = applyMutations(after, inv).daily_orders as unknown as Record<string, unknown>[];
    expect(back.map((r) => [r.id, r.memo]).sort()).toEqual([['a', '처음'], ['b', '지울 것']]);
    expect(back.find((r) => r.id === 'a')?.updated_at).toBe('t9');
  });
  it('바뀐 게 없으면 되돌릴 것도 없음', () => {
    expect(inverseMutations(snap, [{ table: 'daily_orders', op: 'upsert', row: { ...a, updated_at: 't1' } }])).toEqual([]);
  });
});

describe('일주일 지난 일정 잠금', () => {
  const today = '2026-10-30';
  it('오늘-7일까지는 수정 가능, 그 전은 잠김', () => {
    expect(lockCutoff(today)).toBe('2026-10-23');
    const snap = snapWith([{ id: 'old', date: '2026-10-22' }, { id: 'ok', date: '2026-10-23' }]);
    const up = (row: Record<string, unknown>) => ({ table: 'daily_orders', op: 'upsert', row }) as Mutation;
    expect(lockedMutations(snap, [up({ id: 'ok', date: '2026-10-23' })], today)).toHaveLength(0);
    expect(lockedMutations(snap, [up({ id: 'old', date: '2026-10-22' })], today)).toHaveLength(1);
    // 지난 일정을 최근 날짜로 옮기는 것도 잠김
    expect(lockedMutations(snap, [up({ id: 'old', date: '2026-10-30' })], today)).toHaveLength(1);
    // 최근 일정을 지난 날짜로 옮기는 것도 잠김
    expect(lockedMutations(snap, [up({ id: 'ok', date: '2026-10-01' })], today)).toHaveLength(1);
    expect(lockedMutations(snap, [{ table: 'daily_orders', op: 'delete', id: 'old' }], today)).toHaveLength(1);
    // 날짜 없는 표(거래처 등)는 상관없음
    expect(lockedMutations(snap, [{ table: 'clients', op: 'delete', id: 'x' }], today)).toHaveLength(0);
  });
});
