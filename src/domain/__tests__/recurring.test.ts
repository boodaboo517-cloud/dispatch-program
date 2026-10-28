import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, weekdayOf } from '../dates.ts';
import { saveOrder } from '../orders.ts';
import {
  HORIZON_DAYS, RecurringRuleError, planCreateRecurring, planRecurringChange, planRecurringCleanup, planRecurringEnd, recurringOrdersLeft,
  planRecurringExtension, previewRecurringChange, type VersionFields,
} from '../recurring.ts';
import { Tx } from '../tx.ts';
import type { Snapshot } from '../types.ts';
import { baseSnapshot, resetIds } from './fixtures.ts';

const MON = 1, WED = 3, THU = 4, TUE = 2, FRI = 5;

const fields = (p: Partial<VersionFields> = {}): VersionFields => ({
  weekdays: [MON, WED], quantity: 10, unit: '파렛트', region: '서귀포', ship: null, ship_tag: '', vehicle_id: null, memo: '', ...p,
});

/** 2주 전에 등록된 하차 반복 발주(월·수)가 있는 상태 */
function setup(kind: 'unload' | 'load' = 'unload') {
  const created = planCreateRecurring(baseSnapshot(), {
    client_id: 'c-dm', product_id: 'p-gam', zone: 'jeju', kind, fields: fields(kind === 'load' ? { ship: '제이엘' } : {}),
    startDate: '2026-10-05', today: '2026-10-05',
  });
  // 2주가 지나 오늘은 10/20(화)
  const snap = planRecurringExtension(created.snapshot, '2026-10-20').snapshot;
  return { snap, recId: created.recurringId };
}

const ordersOf = (s: Snapshot, recId: string) =>
  s.daily_orders.filter((o) => o.recurring_order_id === recId).sort((a, b) => a.date.localeCompare(b.date));

beforeEach(resetIds);

describe('반복 발주 생성', () => {
  it('오늘 ~ 8주 동안 체크한 요일에만 오더를 만든다', () => {
    const r = planCreateRecurring(baseSnapshot(), {
      client_id: 'c-dm', product_id: 'p-gam', zone: 'jeju', kind: 'unload', fields: fields(),
      startDate: '2026-10-20', today: '2026-10-20',
    });
    const orders = ordersOf(r.snapshot, r.recurringId);
    expect(orders.length).toBe(16); // 8주 × 2요일
    expect(orders.every((o) => [MON, WED].includes(weekdayOf(o.date)))).toBe(true);
    expect(orders[0].date).toBe('2026-10-21');
    expect(orders.at(-1)!.date <= addDays('2026-10-20', HORIZON_DAYS)).toBe(true);
    expect(orders.every((o) => o.source === 'recurring' && !o.edited_manually)).toBe(true);
  });

  it('품목 기본 단가가 있으면 금액도 자동 입력', () => {
    const r = planCreateRecurring(baseSnapshot(), {
      client_id: 'c-dm', product_id: 'p-gam', zone: 'jeju', kind: 'unload', fields: fields(),
      startDate: '2026-10-20', today: '2026-10-20',
    });
    const o = ordersOf(r.snapshot, r.recurringId)[0];
    const rev = r.snapshot.order_revenue.find((x) => x.order_id === o.id)!;
    expect(rev.supply_amount).toBe(900000);
    expect(rev.vat).toBe(90000);
    expect(rev.total).toBe(990000);
  });

  it('스케줄러 연장은 이미 만든 날짜를 다시 만들지 않는다 (사용자가 지운 날짜 포함)', () => {
    const { snap, recId } = setup();
    const before = ordersOf(snap, recId).length;
    // 사용자가 10/26 오더를 지움
    const del = snap.daily_orders.find((o) => o.recurring_order_id === recId && o.date === '2026-10-26')!;
    const s2 = { ...snap, daily_orders: snap.daily_orders.filter((o) => o.id !== del.id) };
    const ext = planRecurringExtension(s2, '2026-10-20');
    expect(ext.created).toBe(0);
    expect(ordersOf(ext.snapshot, recId).length).toBe(before - 1);
    // 하루 지나면 새로 들어온 하루분만
    const next = planRecurringExtension(s2, '2026-10-21');
    expect(next.snapshot.daily_orders.some((o) => o.recurring_order_id === recId && o.date === '2026-10-26')).toBe(false);
  });

  it('과거 날짜를 시작일로 고를 수 없다', () => {
    expect(() =>
      planCreateRecurring(baseSnapshot(), {
        client_id: 'c-dm', product_id: 'p-gam', zone: 'jeju', kind: 'unload', fields: fields(),
        startDate: '2026-10-19', today: '2026-10-20',
      }),
    ).toThrow(RecurringRuleError);
  });
});

describe('반복 발주 변경', () => {
  it('과거 불변: 시작일 이전 오더는 하나도 바뀌지 않는다', () => {
    const { snap, recId } = setup();
    const past = ordersOf(snap, recId).filter((o) => o.date < '2026-10-26');
    expect(past.length).toBeGreaterThan(0);
    const r = planRecurringChange(snap, { recurringId: recId, fields: fields({ quantity: 20 }), startDate: '2026-10-26', today: '2026-10-20' });
    const after = ordersOf(r.snapshot, recId).filter((o) => o.date < '2026-10-26');
    expect(after).toEqual(past);
    // 과거 오더에 대한 mutation 이 없어야 함
    const pastIds = new Set(past.map((o) => o.id));
    expect(r.mutations.some((m) => (m.op === 'delete' ? pastIds.has(m.id) : pastIds.has(m.row.id)))).toBe(false);
  });

  it('버전 분리: 기존 effective_to = 시작일-1, 새 effective_from = 시작일', () => {
    const { snap, recId } = setup();
    const r = planRecurringChange(snap, { recurringId: recId, fields: fields({ quantity: 20 }), startDate: '2026-10-26', today: '2026-10-20' });
    const vs = r.snapshot.recurring_order_versions.filter((v) => v.recurring_order_id === recId).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    expect(vs).toHaveLength(2);
    expect(vs[0].effective_to).toBe('2026-10-25');
    expect(vs[1].effective_from).toBe('2026-10-26');
    expect(vs[1].effective_to).toBeNull();
    const future = ordersOf(r.snapshot, recId).filter((o) => o.date >= '2026-10-26');
    expect(future.every((o) => o.quantity === 20 && o.recurring_version_id === vs[1].id)).toBe(true);
  });

  it('요일 변경: 시작일 이후 월·수 자동 오더는 지우고 화·목으로 다시 만든다', () => {
    const { snap, recId } = setup();
    const r = planRecurringChange(snap, { recurringId: recId, fields: fields({ weekdays: [TUE, THU] }), startDate: '2026-10-22', today: '2026-10-20' });
    const orders = ordersOf(r.snapshot, recId);
    const before = orders.filter((o) => o.date < '2026-10-22');
    const after = orders.filter((o) => o.date >= '2026-10-22');
    expect(before.every((o) => [MON, WED].includes(weekdayOf(o.date)))).toBe(true);
    expect(before.some((o) => o.date === '2026-10-21')).toBe(true); // 어제까지(시작일 전) 수요일 유지
    expect(after.every((o) => [TUE, THU].includes(weekdayOf(o.date)))).toBe(true);
    expect(after[0].date).toBe('2026-10-22');
  });

  it('수동 수정 보존: 직접 고친 오더는 덮어쓰지 않고 개수를 알려준다', () => {
    const { snap, recId } = setup();
    const target = ordersOf(snap, recId).find((o) => o.date === '2026-10-28')!;
    const tx = new Tx(snap);
    saveOrder(tx, { ...target, quantity: 3, memo: '오후 4시 도착' }); // 사람이 일정표에서 고침
    const edited = tx.result();
    expect(edited.daily_orders.find((o) => o.id === target.id)!.edited_manually).toBe(true);

    const r = planRecurringChange(edited, { recurringId: recId, fields: fields({ quantity: 20 }), startDate: '2026-10-26', today: '2026-10-20' });
    expect(r.keptManual).toBe(1);
    const kept = r.snapshot.daily_orders.find((o) => o.id === target.id)!;
    expect(kept.quantity).toBe(3);
    expect(kept.memo).toBe('오후 4시 도착');
    // 같은 날짜에 새 버전 오더가 중복으로 생기지 않는다
    expect(ordersOf(r.snapshot, recId).filter((o) => o.date === '2026-10-28')).toHaveLength(1);
  });

  it('미리보기: 기존/새 내용과 건수', () => {
    const { snap, recId } = setup();
    const p = previewRecurringChange(snap, { recurringId: recId, fields: fields({ weekdays: [FRI], quantity: 5 }), startDate: '2026-10-26', today: '2026-10-20' });
    expect(p.until).toBe('2026-10-25');
    expect(p.before?.weekdays).toBe('월수');
    expect(p.after.weekdays).toBe('금');
    expect(p.after.quantity).toBe('5파렛트');
    expect(p.removed).toBeGreaterThan(0);
    expect(p.pastUntouched).toBeGreaterThan(0);
    // 미리보기는 원본을 바꾸지 않는다
    expect(ordersOf(snap, recId).every((o) => o.quantity === 10)).toBe(true);
  });

  it('같은 시작일로 두 번 바꾸면 예약 버전을 대체한다', () => {
    const { snap, recId } = setup();
    const r1 = planRecurringChange(snap, { recurringId: recId, fields: fields({ quantity: 20 }), startDate: '2026-11-02', today: '2026-10-20' });
    const r2 = planRecurringChange(r1.snapshot, { recurringId: recId, fields: fields({ quantity: 30 }), startDate: '2026-11-02', today: '2026-10-20' });
    const vs = r2.snapshot.recurring_order_versions.filter((v) => v.recurring_order_id === recId);
    expect(vs).toHaveLength(2);
    expect(ordersOf(r2.snapshot, recId).filter((o) => o.date >= '2026-11-02').every((o) => o.quantity === 30)).toBe(true);
  });
});

describe('반복 발주 종료', () => {
  it('종료일 이후 자동 오더만 제거, 종료일까지와 직접 수정은 유지', () => {
    const { snap, recId } = setup();
    const manual = ordersOf(snap, recId).find((o) => o.date === '2026-11-04')!;
    const tx = new Tx(snap);
    saveOrder(tx, { ...manual, memo: '예약' });
    const r = planRecurringEnd(tx.result(), { recurringId: recId, endDate: '2026-10-28', today: '2026-10-20' });
    const orders = ordersOf(r.snapshot, recId);
    expect(orders.filter((o) => o.date > '2026-10-28').map((o) => o.id)).toEqual([manual.id]);
    expect(orders.some((o) => o.date === '2026-10-28')).toBe(true);
    expect(r.keptManual).toBe(1);
    expect(r.snapshot.recurring_orders.find((x) => x.id === recId)!.active).toBe(false);
    // 종료 후 스케줄러가 다시 만들지 않는다
    const ext = planRecurringExtension(r.snapshot, '2026-10-30');
    expect(ext.created).toBe(0);
  });

  it('어제 이전 날짜로 종료할 수 없다', () => {
    const { snap, recId } = setup();
    expect(() => planRecurringEnd(snap, { recurringId: recId, endDate: '2026-10-18', today: '2026-10-20' })).toThrow(RecurringRuleError);
  });
});

describe('반복 상차 → 연결 하차 연쇄', () => {
  it('반복 상차는 다음 날 반대 지역 하차를 함께 만든다', () => {
    const { snap, recId } = setup('load');
    const load = ordersOf(snap, recId).find((o) => o.date === '2026-10-26')!;
    const unload = snap.daily_orders.find((o) => o.linked_from_id === load.id)!;
    expect(unload.zone).toBe('land');
    expect(unload.kind).toBe('unload');
    expect(unload.date).toBe('2026-10-27');
    expect(unload.arrival_ship).toBe('제이엘');
    expect(snap.order_revenue.some((r) => r.order_id === unload.id)).toBe(false); // 매출은 상차에만
  });

  it('변경 시 연결 하차도 과거 불변 / 직접 수정 하차 보존', () => {
    const { snap, recId } = setup('load');
    const pastLoad = ordersOf(snap, recId).find((o) => o.date === '2026-10-14')!;
    const pastUnload = snap.daily_orders.find((o) => o.linked_from_id === pastLoad.id)!;
    const futLoad = ordersOf(snap, recId).find((o) => o.date === '2026-10-28')!;
    const futUnload = snap.daily_orders.find((o) => o.linked_from_id === futLoad.id)!;
    const tx = new Tx(snap);
    saveOrder(tx, { ...futUnload, memo: '2번 도크' });
    const r = planRecurringChange(tx.result(), { recurringId: recId, fields: fields({ quantity: 20, ship: '완도' }), startDate: '2026-10-26', today: '2026-10-20' });
    expect(r.snapshot.daily_orders.find((o) => o.id === pastUnload.id)).toEqual(pastUnload);
    const kept = r.snapshot.daily_orders.find((o) => o.id === futUnload.id)!;
    expect(kept.memo).toBe('2번 도크');
    expect(kept.link_status).toBe('source_deleted');
    expect(r.keptManual).toBe(1);
    const newLoad = ordersOf(r.snapshot, recId).find((o) => o.date === '2026-11-02')!;
    const newUnload = r.snapshot.daily_orders.find((o) => o.linked_from_id === newLoad.id)!;
    expect(newUnload.quantity).toBe(20);
    expect(newUnload.arrival_ship).toBe('완도');
  });
});

describe('반복 발주 중지 → 이후 일정 일괄 삭제', () => {
  it('종료할 때 배차한(고친) 오더와 반대편 연결 하차까지 함께 지운다', () => {
    const { snap, recId } = setup('load');
    const today = '2026-10-20';
    // 앞으로의 상차 하나에 차량 배차 (직접 수정 → 예전에는 남았음)
    const tx = new Tx(snap);
    const future = ordersOf(snap, recId).find((o) => o.date > today)!;
    saveOrder(tx, { ...future, vehicle_id: 'v9915' });
    const s1 = tx.result();
    const keep = planRecurringEnd(s1, { recurringId: recId, endDate: today, today });
    expect(keep.keptManual).toBeGreaterThan(0);
    const all = planRecurringEnd(s1, { recurringId: recId, endDate: today, today, includeEdited: true });
    expect(all.keptManual).toBe(0);
    expect(ordersOf(all.snapshot, recId).filter((o) => o.date > today)).toEqual([]);
    expect(all.snapshot.daily_orders.some((o) => o.linked_from_id === future.id)).toBe(false);
    // 지난 일정은 그대로
    expect(ordersOf(all.snapshot, recId).some((o) => o.date <= today)).toBe(true);
  });
  it('이미 종료했는데 남은 일정은 "남은 일정 지우기"로 오늘부터 모두 삭제', () => {
    const { snap, recId } = setup('load');
    const today = '2026-10-20';
    const tx = new Tx(snap);
    const future = ordersOf(snap, recId).find((o) => o.date > today)!;
    saveOrder(tx, { ...future, vehicle_id: 'v9915' });
    const ended = planRecurringEnd(tx.result(), { recurringId: recId, endDate: today, today }).snapshot;
    expect(recurringOrdersLeft(ended, recId, addDays(today, 1))).toBe(1);
    const cleaned = planRecurringCleanup(ended, { recurringId: recId, fromDate: addDays(today, 1), today });
    expect(cleaned.removed).toBe(1);
    expect(recurringOrdersLeft(cleaned.snapshot, recId, addDays(today, 1))).toBe(0);
  });
});
