// 데모 모드 데이터: 기본 데이터 + 요구사항 예시(10/18 → 10/19)를 오늘 기준으로 재현
import {
  Tx, addDays, applyMutations, blankOrder, planCreateRecurring, planFieldExtension, planRecurringExtension,
  saveOrder, setRowShip, type Snapshot,
} from '../domain/index.ts';
import { SEED_IDS, seedSnapshot } from './seed.ts';

const { sid } = SEED_IDS;

export function demoSnapshot(today: string): Snapshot {
  let s = seedSnapshot();
  const v = (short: string) => s.vehicles.find((x) => x.short_no === short)!.id;
  const c = (name: string) => s.clients.find((x) => x.name === name)!.id;
  const p = (name: string) => s.products.find((x) => x.name === name)!.id;
  const start = addDays(today, -14);

  const r1 = planCreateRecurring(s, {
    client_id: c('도민물류'), product_id: p('감귤'), zone: 'jeju', kind: 'unload', startDate: start, today: start,
    fields: { weekdays: [1, 3, 5], quantity: 10, unit: '파렛트', region: '서귀포', ship: null, ship_tag: '', vehicle_id: null, memo: '' },
  });
  s = r1.snapshot;
  const r2 = planCreateRecurring(s, {
    client_id: c('대동물류'), product_id: p('냉동식품'), zone: 'land', kind: 'load', startDate: start, today: start,
    fields: { weekdays: [2, 4], quantity: 8, unit: '파렛트', region: '부산', ship: '제누2', ship_tag: '', vehicle_id: v('8953'), memo: '' },
  });
  s = planRecurringExtension(r2.snapshot, today).snapshot;
  s = planFieldExtension(s, today).snapshot;

  const tx = new Tx(s);
  const y = addDays(today, -1);
  saveOrder(tx, blankOrder({
    date: y, zone: 'land', kind: 'load', vehicle_id: v('9915'), client_id: c('신제주운송'), product_id: p('잡화'),
    region: '부산', quantity: 2, unit: '파렛트', memo: '제주천 13p', departure_ship: '제이엘',
  }));
  saveOrder(tx, blankOrder({
    date: y, zone: 'jeju', kind: 'load', vehicle_id: v('8948'), client_id: c('제주로지'), product_id: p('산지 감귤'),
    region: '서귀포', quantity: 1, unit: '대', memo: '야간 02시', departure_ship: '제이엘', departure_ship_tag: '야간',
  }));
  setRowShip(tx, { date: y, vehicle_id: v('9914'), zone: 'jeju', which: 'departure', ship: '제이엘', tag: '' });
  saveOrder(tx, blankOrder({
    date: today, zone: 'land', kind: 'load', client_id: c('제주천'), product_id: p('제품'), region: '김해',
    quantity: 13, unit: '파렛트', departure_ship: '완도', memo: '오후 4시 도착',
  }));
  saveOrder(tx, blankOrder({
    date: today, zone: 'jeju', kind: 'load', vehicle_id: v('9915'), client_id: c('도민물류'), product_id: p('감귤'),
    region: '서귀포', quantity: 10, unit: '파렛트', departure_ship: '성우',
  }));
  tx.insert('maintenance_records', {
    id: sid(11, 1), vehicle_id: v('9914'), kind: '엔진오일', shop: '정비실', start_date: addDays(today, -60), end_date: addDays(today, -60),
    odometer_km: 210000, cost: 180000, staff_id: null, memo: '', photo_paths: [],
  });
  tx.insert('maintenance_schedules', {
    id: sid(12, 1), vehicle_id: v('9914'), kind: '정기검사', interval_days: 365, interval_km: null, due_date: addDays(today, 10),
  });
  for (const [i, [d, km]] of ([[-30, 216000], [-10, 221500], [-2, 223600]] as const).entries()) {
    tx.insert('odometer_logs', { id: sid(13, i + 1), vehicle_id: v('9914'), date: addDays(today, d), km });
  }
  return applyMutations(s, tx.mutations());
}
