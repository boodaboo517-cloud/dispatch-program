// 기본 데이터 (거래처·차량·기사·선박·현장근무). supabase/seed.sql 도 이 파일에서 생성한다.
// ※ 첨부 일정표 원본을 받지 못해, 요구사항 본문에 나온 이름만 넣었다. 트럭 기사 이름은 자리표시자다.
import type { Snapshot, Weekday } from '../domain/types.ts';
import { emptySnapshot } from '../domain/types.ts';

const sid = (prefix: number, n: number) =>
  `00000000-0000-4000-8000-${String(prefix).padStart(4, '0')}${String(n).padStart(8, '0')}`;

export const SEED_IDS = { sid };

const MON_SAT: Weekday[] = [1, 2, 3, 4, 5, 6];

export function seedSnapshot(): Snapshot {
  const s = emptySnapshot();

  const ships: [string, string][] = [
    ['완도', '08:40'], ['제누', '13:40'], ['완도', '16:00'], ['제이엘', '16:10'], ['대양', '16:30'],
    ['마린', '16:40'], ['성우', '16:40'], ['제누2', '17:00'], ['완도', '19:30'],
    ['세주', ''], ['퀸메리', ''], ['목포', ''],
  ];
  s.ships = ships.map(([name, t], i) => ({
    id: sid(1, i + 1), name, departs_at: t, route: 'both', arrival_day_offset: 1, sort_order: i, port_times: [],
  }));

  const drivers: [string, string, Weekday[], string, '기사' | '현장' | '사무'][] = [
    ['기사(9915)', '월수금', [1, 3, 5], '경민물류', '기사'],
    ['기사(9914)', '화목일', [2, 4, 0], '경민물류', '기사'],
    ['기사(8948)', '토요일', [6], '경민물류', '기사'],
    ['기사(8953)', '부산상주', [1, 2, 3, 4, 5, 6], '부산', '기사'],
    ['기사(서울)', '서울상주', [1, 2, 3, 4, 5, 6], '서울', '기사'],
    ['양선이', '', MON_SAT, '본사', '사무'],
    ['고정영', '', MON_SAT, '함덕센터', '현장'],
    ['강민수', '', MON_SAT, '함덕센터', '현장'],
    ['홍성제', '', MON_SAT, '제품출고', '현장'],
    ['이진우', '', MON_SAT, '제품출고', '현장'],
    ['김성태', '', MON_SAT, '고산농협', '현장'],
    ['김용현', '', MON_SAT, '목포센터', '현장'],
  ];
  s.drivers = drivers.map(([name, shift, work_days, affiliation, staff_type], i) => ({
    id: sid(2, i + 1), name, phone: '', work_days, shift, affiliation, staff_type, memo: '',
  }));
  const driver = (name: string) => s.drivers.find((d) => d.name === name)!.id;

  // 기사는 매일 일정표에서 지정한다 (차량 기본 기사 없음)
  type V = [string, string, Snapshot['vehicles'][number]['vehicle_type'], '배차' | '업무용', 'land' | 'jeju' | null];
  const vehicles: V[] = [
    ['제주90바9915', '9915', '통윙', '배차', 'land'],
    ['제주90바9914', '9914', '통윙', '배차', 'jeju'],
    ['제주90바8948', '8948', '통윙2냉', '배차', 'jeju'],
    ['제주90바8953', '8953', '5톤', '배차', 'land'],
    ['1전7693', '7693', '1톤', '업무용', 'jeju'],
    ['1톤6899', '6899', '1톤', '업무용', 'jeju'],
    ['1전5521', '5521', '1톤', '업무용', 'jeju'],
    ['1톤7956', '7956', '1톤', '업무용', 'jeju'],
    ['K5 7694', '7694', '승용', '업무용', 'land'],
    ['QM 0160', '0160', '승용', '업무용', 'land'],
  ];
  s.vehicles = vehicles.map(([plate, short_no, vehicle_type, usage, home_zone], i) => ({
    id: sid(3, i + 1), plate, short_no, vehicle_type, usage, ownership: '자차', home_zone,
    default_driver_id: null, status: '운행', sort_order: i, oil_interval_km: null,
  }));
  const vehicle = (short: string) => s.vehicles.find((v) => v.short_no === short)!.id;

  const clients = ['신제주운송', '제주천', '제주로지', '도민물류', '대동물류'];
  s.clients = clients.map((name, i) => ({
    id: sid(4, i + 1), name, manager: '', phone: '', default_ship: null, memo: '',
  }));
  const client = (name: string) => s.clients.find((c) => c.name === name)!.id;

  const blankProduct = {
    pickup_address: '', pickup_lat: null, pickup_lng: null, pickup_note: '',
    dropoff_address: '', dropoff_lat: null, dropoff_lng: null, dropoff_note: '',
    pickup_contact_name: '', pickup_contact_phone: '', dropoff_contact_name: '', dropoff_contact_phone: '',
    temp_min: null, temp_max: null, caution: '',
  };
  s.products = [
    { id: sid(5, 1), client_id: client('신제주운송'), name: '잡화', default_region: '제주시', default_quantity: 2, default_unit: '파렛트', storage: 'ambient', ...blankProduct },
    { id: sid(5, 2), client_id: client('제주천'), name: '제품', default_region: '제주시', default_quantity: 13, default_unit: '파렛트', storage: 'ambient', ...blankProduct },
    { id: sid(5, 3), client_id: client('제주로지'), name: '산지 감귤', default_region: '서귀포', default_quantity: 1, default_unit: '대', storage: 'chilled', ...blankProduct, temp_min: 3, temp_max: 5 },
    { id: sid(5, 4), client_id: client('도민물류'), name: '감귤', default_region: '서귀포', default_quantity: 10, default_unit: '파렛트', storage: 'ambient', ...blankProduct },
    { id: sid(5, 5), client_id: client('대동물류'), name: '냉동식품', default_region: '부산', default_quantity: 8, default_unit: '파렛트', storage: 'frozen', ...blankProduct, temp_min: -20, temp_max: -18 },
  ];
  s.product_pricing = [{ id: sid(6, 1), product_id: sid(5, 4), calc_method: 'per_pallet', unit_price: 90000 }];

  const sites = ['본사', '함덕센터', '제품출고', '고산농협', '목포센터', '정비실'];
  s.field_sites = sites.map((name, i) => ({ id: sid(7, i + 1), name, sort_order: i }));
  const site = (name: string) => s.field_sites.find((x) => x.name === name)!.id;

  const fixed: [string, string, string, string | null][] = [
    ['양선이', '본사', '경리업무', null],
    ['고정영', '함덕센터', '배차·출하 전산관리', null],
    ['강민수', '함덕센터', '배송지원·배차관리', '7693'],
    ['홍성제', '제품출고', '제품출고', '6899'],
    ['이진우', '제품출고', '제품출고', '5521'],
    ['김성태', '고산농협', '농산물 출하관리', '7956'],
    ['김용현', '목포센터', '현장관리·부두 픽업', '7694'],
  ];
  fixed.forEach(([name, siteName, task, v], i) => {
    s.recurring_field_work.push({ id: sid(8, i + 1), staff_id: driver(name), active: true, generated_until: null });
    s.recurring_field_versions.push({
      id: sid(9, i + 1), recurring_field_id: sid(8, i + 1), weekdays: MON_SAT, site_id: site(siteName), task,
      vehicle_id: v ? vehicle(v) : null, effective_from: '2026-01-01', effective_to: null,
    });
  });

  const settings: [string, unknown][] = [
    ['maintenance_shops', ['회성', '산지', '타타', '정비실']],
    ['memo_phrases', ['야간 02시', '오후 4시 도착', '예약', '아침', '대기', '경유']],
    ['header_notice', '경민물류 일정표'],
    ['oil_interval_km', 15000],
    ['driver_suggestions', false],
    ['dispatcher_phone', ''],
  ];
  s.settings = settings.map(([key, value], i) => ({ id: sid(10, i + 1), key, value }));
  return s;
}
