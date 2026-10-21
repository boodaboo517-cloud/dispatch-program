// 경민물류 배차 도메인 타입. DB 컬럼명과 동일하게 snake_case 를 사용한다.

export type Zone = 'land' | 'jeju';
/** 육지: unload=하차 / load=상차, 제주: unload=오전(하차) / load=오후(상차) */
export type Kind = 'unload' | 'load';
export type Unit = '대' | '파렛트' | 'm' | '박스' | '';
/** 선박 칸에 붙는 표시 ("아침 마린", "야간", "대한물류 예약" 처럼 예약해 준 업체 이름도 들어갈 수 있음) */
export type ShipTag = string;
export const SHIP_TAG_PRESETS = ['아침', '예약', '야간'] as const;

/** 운송 방법: 직영 차량 / 용차(외부 차량) / 화주가 직접 배차 */
export type CarrierType = 'own' | 'hired' | 'shipper';
export const CARRIER_LABEL: Record<CarrierType, string> = { own: '직영', hired: '용차', shipper: '화주배차' };
/** 선적 방법: 차량째 선적 / 벌크(화물만 선적 → 도착지에서 다시 배차) */
export type Shipment = 'vehicle' | 'bulk';
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=일 … 6=토
export type Role = 'admin' | 'dispatcher' | 'viewer';
export type VehicleType = '5톤' | '통윙' | '통윙2냉' | '1톤' | '승용';
export type VehicleUsage = '배차' | '업무용';
export type Ownership = '자차' | '개인';
export type VehicleStatus = '운행' | '정비' | '휴차';
export type DayStatus = '' | 'empty' | 'repair' | 'rest' | 'other';
export type Storage = 'ambient' | 'chilled' | 'frozen';
export type CalcMethod = 'per_pallet' | 'per_unit' | 'fixed';
export type BillingStatus = '미청구' | '청구' | '입금';
export type LinkStatus = 'none' | 'synced' | 'source_changed' | 'source_deleted';
export type ShipRoute = 'up' | 'down' | 'both';

interface Base {
  id: string;
  updated_at?: string;
  updated_by?: string | null;
}

export interface Client extends Base {
  name: string;
  manager: string;
  phone: string;
  default_ship: string | null;
  memo: string;
  pickup_address?: string;
  dropoff_address?: string;
  pickup_contact_name?: string;
  pickup_contact_phone?: string;
  dropoff_contact_name?: string;
  dropoff_contact_phone?: string;
}

export interface Product extends Base {
  client_id: string;
  name: string;
  default_region: string;
  default_quantity: number | null;
  default_unit: Unit;
  pickup_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_note: string;
  dropoff_address: string;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dropoff_note: string;
  pickup_contact_name: string;
  pickup_contact_phone: string;
  dropoff_contact_name: string;
  dropoff_contact_phone: string;
  storage: Storage;
  temp_min: number | null;
  temp_max: number | null;
  caution: string;
}

/** 품목 기본 단가 — 금액 정보라 별도 테이블(관리자·배차만 RLS 허용) */
export interface ProductPricing extends Base {
  product_id: string;
  calc_method: CalcMethod;
  unit_price: number;
}

export interface Vehicle extends Base {
  plate: string;
  short_no: string; // 표시용 뒤 4자리
  vehicle_type: VehicleType;
  usage: VehicleUsage;
  ownership: Ownership;
  /** 더 이상 쓰지 않음 (기사는 매일 일정표에서 지정) — 기존 데이터 호환용 */
  default_driver_id: string | null;
  status: VehicleStatus;
  home_zone: Zone | null; // 처음 등록 시 현재 위치 (null = 위치 미정)
  sort_order: number;
  oil_interval_km: number | null;
}

export interface Driver extends Base {
  name: string;
  phone: string;
  /** 근무 요일 (0=일 … 6=토) */
  work_days: Weekday[];
  /** 근무조 라벨: 월수금 / 화목일 / 월수 / 토요일 / 주말 / 알바 / 부산상주 / 서울상주 */
  shift: string;
  affiliation: string;
  /** 직원 구분: 기사 / 현장 / 사무 */
  staff_type: '기사' | '현장' | '사무';
  memo?: string;
  /** 팀 (기사 선택 목록 묶음). 비우면 근무조로 묶는다 */
  team?: string;
}

/** 기사 선택·근무현황에서 묶는 기준: 팀 → 근무조 → "팀 없음" */
export const driverGroup = (d: Pick<Driver, 'team' | 'shift'>) => d.team?.trim() || d.shift || '팀 없음';

/** 알바: 정해진 근무일 없이 출근 기록이 있는 날만 근무 */
export const ON_CALL_SHIFT = '알바';
export const SHIFT_PRESETS: Record<string, Weekday[]> = {
  월수금: [1, 3, 5],
  화목일: [2, 4, 0],
  월수: [1, 3],
  토요일: [6],
  주말: [6, 0],
  [ON_CALL_SHIFT]: [],
};

export const WORK_TYPES = ['주간근무', '야간근무', '특근', '출장', '장거리', '단거리', '야간단거리', '시간외근무'] as const;
export type WorkType = (typeof WORK_TYPES)[number];
/** 월간 근무현황 표의 한 칸 표시용 약자 */
export const WORK_TYPE_SHORT: Record<WorkType, string> = {
  주간근무: '주', 야간근무: '야', 특근: '특', 출장: '출', 장거리: '장', 단거리: '단', 야간단거리: '야단', 시간외근무: '시',
};

/** 기사 하루 근무 기록 (근무형태 · 알바 출근) */
export interface DriverWorkLog extends Base {
  date: string;
  driver_id: string;
  work_types: WorkType[];
  memo: string;
}

export interface Ship extends Base {
  name: string;
  departs_at: string; // HH:mm
  route: ShipRoute;
  arrival_day_offset: number; // 도착일 차이 (기본 1)
  sort_order: number;
  /** departs_at = 제주 출발(상행) 시간, port_times = 기항지별 하행(육지 → 제주) 출발 시간 */
  port_times?: { port: string; time: string }[];
}

export interface OrderSnapshot {
  vehicle_id: string | null;
  client_id: string | null;
  client_text: string;
  product_id: string | null;
  product_text: string;
  region: string;
  quantity: number | null;
  unit: Unit;
  memo: string;
  arrival_ship: string | null;
  arrival_ship_tag: ShipTag;
  date: string;
  pickup_place?: string;
  dropoff_place?: string;
  carrier_type?: CarrierType;
  carrier_name?: string;
  carrier_vehicle?: string;
  carrier_phone?: string;
}

export interface DailyOrder extends Base {
  date: string; // YYYY-MM-DD
  zone: Zone;
  kind: Kind;
  client_id: string | null;
  client_text: string; // "직접 쓰기" 자유 입력
  product_id: string | null;
  product_text: string;
  region: string;
  quantity: number | null;
  unit: Unit;
  memo: string;
  vehicle_id: string | null;
  driver_id: string | null;
  /** 이 구역으로 들어온 선박 (육지=상행선박, 제주=도착 선박) */
  arrival_ship: string | null;
  arrival_ship_tag: ShipTag;
  /** 이 구역에서 나가는 선박 (육지=하행선박, 제주=오후 선박) */
  departure_ship: string | null;
  departure_ship_tag: ShipTag;
  sort_order: number;
  source: 'manual' | 'recurring' | 'linked';
  recurring_order_id: string | null;
  recurring_version_id: string | null;
  edited_manually: boolean;
  linked_from_id: string | null;
  link_status: LinkStatus;
  /** 원본 상차가 바뀌었지만 직접 수정 때문에 반영 대기 중인 값 */
  link_pending: Partial<OrderSnapshot> | null;
  /** 상차지 · 하차지 (오더마다 다를 수 있음) */
  pickup_place?: string;
  dropoff_place?: string;
  /** 당일 왕복: 올라가서 상차하고 같은 날 내려옴 → 연결 하차가 같은 날짜, 차량 위치는 안 바뀜 */
  same_day?: boolean;
  /** 직영 / 용차 / 화주배차. 용차·화주배차는 차량번호 없이 아래 글자로 표시하고 배차 대기로 세지 않는다 */
  carrier_type?: CarrierType;
  carrier_name?: string;
  carrier_vehicle?: string;
  carrier_phone?: string;
  /** 차량째 선적 / 벌크. 벌크는 차량이 배를 타지 않으므로 반대편 하차를 차량 없이 만든다 */
  shipment?: Shipment;
  /** 연결 하차까지 걸리는 날 (비우면 선박 설정, 마감으로 다음 배를 타면 +1) */
  arrival_offset?: number | null;
}

/** 차량별 하루 한 줄 — 선박·상태·기사 등 차량 단위 정보 */
export interface VehicleDay extends Base {
  date: string;
  vehicle_id: string;
  zone: Zone | null;
  driver_id: string | null;
  arrival_ship: string | null;
  arrival_ship_tag: ShipTag;
  departure_ship: string | null;
  departure_ship_tag: ShipTag;
  status: DayStatus;
  status_memo: string;
  /** 전날 하행(출발) 선박에서 자동으로 이어진 경우 원본 vehicle_day id */
  arrival_from_id: string | null;
  arrival_edited_manually: boolean;
  arrival_pending: { ship: string | null; tag: ShipTag } | null;
}

export interface RecurringOrder extends Base {
  client_id: string;
  product_id: string | null;
  zone: Zone;
  kind: Kind;
  active: boolean;
  /** 이 날짜까지 daily_orders 를 만들어 두었음 (사용자가 지운 날짜를 다시 만들지 않기 위함) */
  generated_until: string | null;
}

export interface RecurringOrderVersion extends Base {
  recurring_order_id: string;
  weekdays: Weekday[];
  quantity: number | null;
  unit: Unit;
  region: string;
  ship: string | null; // 상차면 출발 선박, 하차면 도착 선박
  ship_tag: ShipTag;
  vehicle_id: string | null;
  memo: string;
  effective_from: string;
  effective_to: string | null;
}

export interface OrderRevenue extends Base {
  order_id: string;
  calc_method: CalcMethod;
  unit_price: number | null;
  quantity: number | null;
  extras: { label: string; amount: number }[];
  supply_amount: number | null;
  vat: number | null;
  total: number | null;
  bill_to_client_id: string | null;
  billing_status: BillingStatus;
}

export interface FieldSite extends Base {
  name: string;
  sort_order: number;
}

export interface FieldAssignment extends Base {
  date: string;
  site_id: string | null;
  staff_id: string | null;
  task: string;
  vehicle_id: string | null;
  source: 'manual' | 'recurring' | 'maintenance';
  recurring_field_id: string | null;
  recurring_field_version_id: string | null;
  edited_manually: boolean;
  is_off: boolean; // 휴무자 줄
  maintenance_record_id: string | null;
  sort_order: number;
}

export interface RecurringFieldWork extends Base {
  staff_id: string;
  active: boolean;
  generated_until: string | null;
}

export interface RecurringFieldVersion extends Base {
  recurring_field_id: string;
  weekdays: Weekday[];
  site_id: string | null;
  task: string;
  vehicle_id: string | null;
  effective_from: string;
  effective_to: string | null;
}

export const MAINTENANCE_KINDS = [
  '차량 점검', '정기검사', '엔진오일', '미션오일', '타이어', '밧데리',
  '적재함 수리', '윈치 수리', '에어 빼기', '기타',
] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export interface MaintenanceRecord extends Base {
  vehicle_id: string;
  kind: MaintenanceKind;
  shop: string;
  start_date: string;
  end_date: string | null; // null = 정비 중
  odometer_km: number | null;
  cost: number | null;
  staff_id: string | null;
  memo: string;
  photo_paths: string[];
}

export interface MaintenanceSchedule extends Base {
  vehicle_id: string;
  kind: MaintenanceKind;
  interval_days: number | null;
  interval_km: number | null;
  due_date: string | null; // 정기검사 만료일 등 직접 지정
}

export interface OdometerLog extends Base {
  vehicle_id: string;
  date: string;
  km: number;
}

export interface ProductPhoto extends Base {
  product_id: string;
  path: string;
  caption: string;
}

export interface ProductSuggestion extends Base {
  product_id: string;
  kind: 'photo' | 'caution';
  payload: string;
  status: 'pending' | 'approved' | 'rejected';
  created_by: string | null;
}

export interface Setting extends Base {
  key: string;
  value: unknown;
}

export interface AppNotice extends Base {
  date: string;
  vehicle_id: string | null;
  driver_id: string | null;
  message: string;
  created_at: string;
}

/** 클라이언트가 들고 있는 전체 데이터 묶음 */
export interface Snapshot {
  clients: Client[];
  products: Product[];
  product_pricing: ProductPricing[];
  product_photos: ProductPhoto[];
  product_suggestions: ProductSuggestion[];
  vehicles: Vehicle[];
  drivers: Driver[];
  driver_work_logs: DriverWorkLog[];
  ships: Ship[];
  daily_orders: DailyOrder[];
  vehicle_days: VehicleDay[];
  recurring_orders: RecurringOrder[];
  recurring_order_versions: RecurringOrderVersion[];
  order_revenue: OrderRevenue[];
  field_sites: FieldSite[];
  field_assignments: FieldAssignment[];
  recurring_field_work: RecurringFieldWork[];
  recurring_field_versions: RecurringFieldVersion[];
  maintenance_records: MaintenanceRecord[];
  maintenance_schedules: MaintenanceSchedule[];
  odometer_logs: OdometerLog[];
  settings: Setting[];
  notices: AppNotice[];
}

export type TableName = keyof Snapshot;
export const TABLES: TableName[] = [
  'clients', 'products', 'product_pricing', 'product_photos', 'product_suggestions',
  'vehicles', 'drivers', 'driver_work_logs', 'ships', 'daily_orders', 'vehicle_days', 'recurring_orders',
  'recurring_order_versions', 'order_revenue', 'field_sites', 'field_assignments',
  'recurring_field_work', 'recurring_field_versions', 'maintenance_records',
  'maintenance_schedules', 'odometer_logs', 'settings', 'notices',
];
/** 금액 테이블 — 조회(기사) 계정에는 서버에서 내려주지 않는다 */
export const MONEY_TABLES: TableName[] = ['order_revenue', 'product_pricing'];

export type Mutation =
  | { table: TableName; op: 'upsert'; row: { id: string } & Record<string, unknown> }
  | { table: TableName; op: 'delete'; id: string };

export function emptySnapshot(): Snapshot {
  const s = {} as Snapshot;
  for (const t of TABLES) (s as unknown as Record<string, unknown[]>)[t] = [];
  return s;
}
