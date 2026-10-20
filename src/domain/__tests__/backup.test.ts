import { describe, expect, it } from 'vitest';
import { BackupError, makeBackup, parseBackup, uploadPlan } from '../../data/backup.ts';
import { baseSnapshot, demoSnapshot } from '../../data/demo.ts';

describe('백업 · 서버 옮기기', () => {
  it('백업 파일을 저장했다가 그대로 불러온다', () => {
    const s = demoSnapshot('2026-10-21');
    const back = parseBackup(JSON.stringify(makeBackup(s)));
    expect(back.snapshot).toEqual(s);
  });

  it('다른 파일은 거부한다', () => {
    expect(() => parseBackup('{"a":1}')).toThrow(BackupError);
    expect(() => parseBackup('엑셀')).toThrow(BackupError);
    expect(() => parseBackup(JSON.stringify({ app: 'gyeongmin-dispatch', version: 1, snapshot: { clients: [{ name: 'x' }] } }))).toThrow(BackupError);
  });

  it('업로드 순서: 부모 표 먼저, 연결 하차는 원본 상차 뒤, 이어진 차량 줄은 전날 줄 뒤', () => {
    const plan = uploadPlan(demoSnapshot('2026-10-21'));
    const tables = plan.map((p) => p.table);
    expect(tables.indexOf('clients')).toBeLessThan(tables.indexOf('products'));
    expect(tables.indexOf('daily_orders')).toBeLessThan(tables.indexOf('order_revenue'));
    expect(tables.indexOf('maintenance_records')).toBeLessThan(tables.indexOf('field_assignments'));
    const orders = plan.find((p) => p.table === 'daily_orders')!.rows;
    const pos = new Map(orders.map((o, i) => [o.id, i]));
    for (const o of orders) if (o.linked_from_id) expect(pos.get(o.linked_from_id as string)!).toBeLessThan(pos.get(o.id)!);
    const vds = plan.find((p) => p.table === 'vehicle_days')!.rows;
    const vpos = new Map(vds.map((o, i) => [o.id, i]));
    for (const v of vds) if (v.arrival_from_id) expect(vpos.get(v.arrival_from_id as string)!).toBeLessThan(vpos.get(v.id)!);
    expect(orders.every((o) => !('updated_by' in o))).toBe(true);
  });

  it('기본 명단 시작: 예시 오더 없이 명단·고정 근무만', () => {
    const s = baseSnapshot('2026-10-21');
    expect(s.daily_orders).toHaveLength(0);
    expect(s.recurring_orders).toHaveLength(0);
    expect(s.clients.some((c) => c.name === '대동물류')).toBe(false);
    expect(s.vehicles.length).toBeGreaterThan(0);
    expect(s.field_assignments.length).toBeGreaterThan(0);
  });
});
