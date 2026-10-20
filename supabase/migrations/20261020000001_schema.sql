-- 경민물류 배차 스키마
create extension if not exists pgcrypto;

-- ───────── 사용자 · 권한 ─────────
create table drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  work_days smallint[] not null default '{}',     -- 0=일 … 6=토
  shift text not null default '',                  -- 월수금 / 화목일 / 토요일 / 부산상주 / 서울상주
  affiliation text not null default '',
  staff_type text not null default '기사' check (staff_type in ('기사','현장','사무')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  role text not null default 'viewer' check (role in ('admin','dispatcher','viewer')),
  driver_id uuid references drivers on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function app_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()), 'viewer')
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select app_role() in ('admin','dispatcher')
$$;

create or replace function my_driver_id() returns uuid
language sql stable security definer set search_path = public as $$
  select driver_id from profiles where id = auth.uid()
$$;

-- 새 가입자는 조회(기사) 권한으로 시작 — 관리자가 설정 화면에서 바꾼다
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
          case when (select count(*) from profiles) = 0 then 'admin' else 'viewer' end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ───────── 기준 정보 ─────────
create table ships (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  departs_at text not null default '',             -- HH:mm
  route text not null default 'both' check (route in ('up','down','both')),
  arrival_day_offset smallint not null default 1,  -- 도착일 차이
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  manager text not null default '',
  phone text not null default '',
  default_ship text,
  memo text not null default '',
  pickup_address text not null default '',
  dropoff_address text not null default '',
  pickup_contact_name text not null default '',
  pickup_contact_phone text not null default '',
  dropoff_contact_name text not null default '',
  dropoff_contact_phone text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table products (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients on delete cascade,
  name text not null,
  default_region text not null default '',
  default_quantity numeric,
  default_unit text not null default '' check (default_unit in ('','대','파렛트','m','박스')),
  pickup_address text not null default '',
  pickup_lat double precision, pickup_lng double precision,
  pickup_note text not null default '',
  dropoff_address text not null default '',
  dropoff_lat double precision, dropoff_lng double precision,
  dropoff_note text not null default '',
  pickup_contact_name text not null default '',
  pickup_contact_phone text not null default '',
  dropoff_contact_name text not null default '',
  dropoff_contact_phone text not null default '',
  storage text not null default 'ambient' check (storage in ('ambient','chilled','frozen')),
  temp_min numeric, temp_max numeric,
  caution text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on products (client_id);

-- 금액: 관리자·배차만 (기사·조회 계정은 RLS 로 행 자체가 내려가지 않음)
create table product_pricing (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references products on delete cascade,
  calc_method text not null check (calc_method in ('per_pallet','per_unit','fixed')),
  unit_price numeric not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table product_photos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products on delete cascade,
  path text not null,
  caption text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table product_suggestions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products on delete cascade,
  kind text not null check (kind in ('photo','caution')),
  payload text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text not null,
  short_no text not null,
  vehicle_type text not null default '5톤' check (vehicle_type in ('5톤','통윙','통윙2냉','1톤','승용')),
  usage text not null default '배차' check (usage in ('배차','업무용')),
  ownership text not null default '자차' check (ownership in ('자차','개인')),
  default_driver_id uuid references drivers on delete set null,
  status text not null default '운행' check (status in ('운행','정비','휴차')),
  home_zone text check (home_zone in ('land','jeju')),
  sort_order int not null default 0,
  oil_interval_km int,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ───────── 반복 발주 ─────────
create table recurring_orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients on delete cascade,
  product_id uuid references products on delete set null,
  zone text not null check (zone in ('land','jeju')),
  kind text not null check (kind in ('unload','load')),
  active boolean not null default true,
  generated_until date,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table recurring_order_versions (
  id uuid primary key default gen_random_uuid(),
  recurring_order_id uuid not null references recurring_orders on delete cascade,
  weekdays smallint[] not null,
  quantity numeric,
  unit text not null default '',
  region text not null default '',
  ship text,
  ship_tag text not null default '',
  vehicle_id uuid references vehicles on delete set null,
  memo text not null default '',
  effective_from date not null,
  effective_to date,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (effective_to is null or effective_to >= effective_from - 1)
);
create index on recurring_order_versions (recurring_order_id, effective_from);

-- ───────── 날짜별 오더 ─────────
create table daily_orders (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  zone text not null check (zone in ('land','jeju')),
  kind text not null check (kind in ('unload','load')),     -- 제주: unload=오전, load=오후
  client_id uuid references clients on delete set null,
  client_text text not null default '',
  product_id uuid references products on delete set null,
  product_text text not null default '',
  region text not null default '',
  quantity numeric,
  unit text not null default '',
  memo text not null default '',
  vehicle_id uuid references vehicles on delete set null,
  driver_id uuid references drivers on delete set null,
  arrival_ship text,            -- 육지=상행선박 / 제주=도착 선박
  arrival_ship_tag text not null default '',
  departure_ship text,          -- 육지=하행선박 / 제주=오후 선박
  departure_ship_tag text not null default '',
  sort_order int not null default 0,
  source text not null default 'manual' check (source in ('manual','recurring','linked')),
  recurring_order_id uuid references recurring_orders on delete set null,
  recurring_version_id uuid references recurring_order_versions on delete set null,
  edited_manually boolean not null default false,
  linked_from_id uuid references daily_orders on delete set null deferrable initially deferred,
  link_status text not null default 'none' check (link_status in ('none','synced','source_changed','source_deleted')),
  link_pending jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on daily_orders (date);
create index on daily_orders (recurring_order_id, date);
create index on daily_orders (linked_from_id);
create index on daily_orders (vehicle_id, date);
-- 스케줄러와 앱이 동시에 연장해도 같은 날짜 반복 오더가 두 번 생기지 않게
create unique index daily_orders_recurring_once on daily_orders (recurring_order_id, date) where source = 'recurring';

create table vehicle_days (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  vehicle_id uuid not null references vehicles on delete cascade,
  zone text check (zone in ('land','jeju')),
  driver_id uuid references drivers on delete set null,
  arrival_ship text,
  arrival_ship_tag text not null default '',
  departure_ship text,
  departure_ship_tag text not null default '',
  status text not null default '' check (status in ('','empty','repair','rest','other')),
  status_memo text not null default '',
  arrival_from_id uuid references vehicle_days on delete set null deferrable initially deferred,
  arrival_edited_manually boolean not null default false,
  arrival_pending jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (date, vehicle_id) deferrable initially deferred
);

-- 매출 (오더별) — 금액이라 별도 테이블 + 관리자·배차 전용 RLS
create table order_revenue (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references daily_orders on delete cascade deferrable initially deferred,
  calc_method text not null default 'per_pallet' check (calc_method in ('per_pallet','per_unit','fixed')),
  unit_price numeric,
  quantity numeric,
  extras jsonb not null default '[]',
  supply_amount numeric,
  vat numeric,
  total numeric,
  bill_to_client_id uuid references clients on delete set null,
  billing_status text not null default '미청구' check (billing_status in ('미청구','청구','입금')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ───────── 현장근무 ─────────
create table field_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table recurring_field_work (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references drivers on delete cascade,
  active boolean not null default true,
  generated_until date,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table recurring_field_versions (
  id uuid primary key default gen_random_uuid(),
  recurring_field_id uuid not null references recurring_field_work on delete cascade,
  weekdays smallint[] not null,
  site_id uuid references field_sites on delete set null,
  task text not null default '',
  vehicle_id uuid references vehicles on delete set null,
  effective_from date not null,
  effective_to date,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ───────── 정비 ─────────
create table maintenance_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles on delete cascade,
  kind text not null,
  shop text not null default '',
  start_date date not null,
  end_date date,
  odometer_km int,
  cost numeric,
  staff_id uuid references drivers on delete set null,
  memo text not null default '',
  photo_paths text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on maintenance_records (vehicle_id, start_date);

create table field_assignments (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  site_id uuid references field_sites on delete set null,
  staff_id uuid references drivers on delete cascade,
  task text not null default '',
  vehicle_id uuid references vehicles on delete set null,
  source text not null default 'manual' check (source in ('manual','recurring','maintenance')),
  recurring_field_id uuid references recurring_field_work on delete set null,
  recurring_field_version_id uuid references recurring_field_versions on delete set null,
  edited_manually boolean not null default false,
  is_off boolean not null default false,
  maintenance_record_id uuid references maintenance_records on delete cascade,
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on field_assignments (date);
create unique index field_assignments_recurring_once on field_assignments (recurring_field_id, date) where source = 'recurring';

create table maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles on delete cascade,
  kind text not null,
  interval_days int,
  interval_km int,
  due_date date,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table odometer_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles on delete cascade,
  date date not null,
  km int not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on odometer_logs (vehicle_id, date);

-- ───────── 설정 · 알림 · 이력 ─────────
create table settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table notices (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  vehicle_id uuid references vehicles on delete cascade,
  driver_id uuid references drivers on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table audit_log (
  id bigserial primary key,
  table_name text not null,
  row_id uuid,
  op text not null,
  old_row jsonb,
  new_row jsonb,
  actor uuid,
  at timestamptz not null default now()
);
create index on audit_log (table_name, row_id, at desc);
