-- 경민물류 배차: Supabase 처음 설정 (SQL Editor 에 통째로 붙여넣고 Run). npm run setup:sql 로 다시 만든다.
-- 새벽 스케줄러(20261020000003_scheduler.sql)는 Vault 설정 뒤 따로 실행.

-- ===== 20261020000001_schema.sql =====
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

-- ===== 20261020000002_rls_audit_realtime.sql =====
-- 권한(RLS) · 변경 이력 · 실시간 · 기사 알림

-- ───────── updated_at / updated_by 자동 기록 ─────────
create or replace function touch_row() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- ───────── 변경 이력 (누가·언제·무엇을) ─────────
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (table_name, row_id, op, old_row, new_row, actor)
  values (tg_table_name,
          coalesce((case when tg_op = 'DELETE' then old.id else new.id end), null),
          tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
          auth.uid());
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'drivers','ships','clients','products','product_pricing','product_photos','product_suggestions',
    'vehicles','recurring_orders','recurring_order_versions','daily_orders','vehicle_days','order_revenue',
    'field_sites','recurring_field_work','recurring_field_versions','field_assignments',
    'maintenance_records','maintenance_schedules','odometer_logs','settings','notices'
  ] loop
    execute format('create trigger touch before insert or update on %I for each row execute function touch_row()', t);
    execute format('create trigger audit after insert or update or delete on %I for each row execute function audit_row()', t);
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I replica identity full', t);
    execute format('alter publication supabase_realtime add table %I', t);
  end loop;
end $$;

alter table profiles enable row level security;
alter table audit_log enable row level security;

-- ───────── 기본 정책: 로그인 사용자 읽기, 관리자·배차만 쓰기 ─────────
do $$
declare t text;
begin
  foreach t in array array[
    'drivers','ships','clients','products','product_photos','vehicles','recurring_orders',
    'recurring_order_versions','daily_orders','vehicle_days','field_sites','recurring_field_work',
    'recurring_field_versions','field_assignments','maintenance_records','maintenance_schedules','odometer_logs'
  ] loop
    execute format('create policy "read" on %I for select to authenticated using (true)', t);
    execute format('create policy "staff insert" on %I for insert to authenticated with check (is_staff())', t);
    execute format('create policy "staff update" on %I for update to authenticated using (is_staff()) with check (is_staff())', t);
    execute format('create policy "staff delete" on %I for delete to authenticated using (is_staff())', t);
  end loop;
end $$;

-- 금액 테이블: 관리자·배차만. 기사·조회 계정은 select 정책이 없으므로 행이 아예 내려가지 않는다.
create policy "staff all" on order_revenue for all to authenticated using (is_staff()) with check (is_staff());
create policy "staff all" on product_pricing for all to authenticated using (is_staff()) with check (is_staff());

-- 기사: 본인 차량 주행거리 입력 허용
create policy "driver odometer" on odometer_logs for insert to authenticated with check (
  exists (select 1 from vehicles v where v.id = vehicle_id and v.default_driver_id = my_driver_id())
  or exists (select 1 from vehicle_days d where d.vehicle_id = odometer_logs.vehicle_id and d.driver_id = my_driver_id())
);

-- 기사 제안(사진·주의사항) — 설정에서 허용했을 때만, 관리자 승인 후 반영
create policy "read own or staff" on product_suggestions for select to authenticated
  using (is_staff() or created_by = auth.uid());
create policy "driver suggest" on product_suggestions for insert to authenticated with check (
  is_staff() or (
    created_by = auth.uid() and status = 'pending'
    and coalesce((select (value)::text = 'true' from settings where key = 'driver_suggestions'), false)
  )
);
create policy "staff review" on product_suggestions for update to authenticated using (is_staff()) with check (is_staff());
create policy "staff delete" on product_suggestions for delete to authenticated using (is_staff());

create policy "read" on settings for select to authenticated using (true);
create policy "admin write" on settings for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');

create policy "read mine or staff" on notices for select to authenticated using (is_staff() or driver_id = my_driver_id());
create policy "staff write" on notices for all to authenticated using (is_staff()) with check (is_staff());

create policy "read self or staff" on profiles for select to authenticated using (id = auth.uid() or is_staff());
create policy "admin update" on profiles for update to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');

create policy "staff read" on audit_log for select to authenticated using (is_staff());

alter publication supabase_realtime add table profiles;

-- ───────── 기사 알림: 본인 배차가 바뀌면 notices 에 기록 (앱 상단 노란 띠 + 알림) ─────────
create or replace function notify_driver_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  drv uuid;
  msg text;
  zone_label text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.date < (now() at time zone 'Asia/Seoul')::date then return null; end if;

  if tg_table_name = 'vehicle_days' then
    drv := r.driver_id;
    if drv is null or tg_op <> 'UPDATE' then return null; end if;
    zone_label := case when new.zone = 'jeju' then '오후 선박' else '하행선박' end;
    if new.departure_ship is distinct from old.departure_ship then
      msg := format('%s %s로 변경', zone_label, coalesce(trim(new.departure_ship_tag || ' ' || new.departure_ship), '없음'));
    elsif new.arrival_ship is distinct from old.arrival_ship then
      msg := format('%s %s로 변경', case when new.zone = 'jeju' then '도착 선박' else '상행선박' end,
                    coalesce(trim(new.arrival_ship_tag || ' ' || new.arrival_ship), '없음'));
    else
      return null;
    end if;
  else
    drv := coalesce(r.driver_id, (select driver_id from vehicle_days d where d.date = r.date and d.vehicle_id = r.vehicle_id));
    if drv is null then return null; end if;
    msg := format('%s %s %s',
      case when r.kind = 'load' then '상차' else '하차' end,
      coalesce((select name from clients c where c.id = r.client_id), r.client_text, ''),
      case tg_op when 'INSERT' then '추가' when 'DELETE' then '취소' else '변경' end);
    if tg_op = 'UPDATE' and new.departure_ship is distinct from old.departure_ship then
      msg := format('상차 선박 %s로 변경', coalesce(new.departure_ship, '없음'));
    end if;
  end if;

  insert into notices (date, vehicle_id, driver_id, message) values (r.date, r.vehicle_id, drv, msg);
  return null;
end $$;

create trigger driver_notice after update on vehicle_days for each row execute function notify_driver_change();
create trigger driver_notice after insert or update or delete on daily_orders for each row execute function notify_driver_change();

-- ───────── 사진 저장소 ─────────
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict do nothing;
create policy "photos read" on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy "photos staff write" on storage.objects for insert to authenticated with check (
  bucket_id = 'photos' and (is_staff() or (storage.foldername(name))[1] = 'suggestions')
);
create policy "photos staff delete" on storage.objects for delete to authenticated using (bucket_id = 'photos' and is_staff());

-- ===== 20261021000004_workforce_ships_orders.sql =====
-- 기사 비고·근무 기록, 선박 기항지별 하행 시간, 오더 상차지/하차지·당일 왕복

alter table drivers add column if not exists memo text not null default '';

create table driver_work_logs (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  driver_id uuid not null references drivers on delete cascade,
  work_types text[] not null default '{}',   -- 주간근무, 야간근무, 특근, 출장, 장거리, 단거리, 야간단거리, 시간외근무
  memo text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (driver_id, date)
);
create index on driver_work_logs (date);

create trigger touch before insert or update on driver_work_logs for each row execute function touch_row();
create trigger audit after insert or update or delete on driver_work_logs for each row execute function audit_row();
alter table driver_work_logs enable row level security;
alter table driver_work_logs replica identity full;
alter publication supabase_realtime add table driver_work_logs;
create policy "read" on driver_work_logs for select to authenticated using (true);
create policy "staff insert" on driver_work_logs for insert to authenticated with check (is_staff());
create policy "staff update" on driver_work_logs for update to authenticated using (is_staff()) with check (is_staff());
create policy "staff delete" on driver_work_logs for delete to authenticated using (is_staff());

-- departs_at = 제주 출발(상행), port_times = [{"port":"목포","time":"01:00"}, …] 기항지별 하행 출발
alter table ships add column if not exists port_times jsonb not null default '[]';

alter table daily_orders
  add column if not exists pickup_place text not null default '',
  add column if not exists dropoff_place text not null default '',
  add column if not exists same_day boolean not null default false;

-- ===== 20261021000005_carrier_bulk.sql =====
-- 용차·화주배차, 벌크 선적, 하차 날짜 조정. 선박 표시(ship_tag)는 예약 업체 이름도 쓰므로 자유 글자.
alter table daily_orders
  add column if not exists carrier_type text not null default 'own' check (carrier_type in ('own','hired','shipper')),
  add column if not exists carrier_name text not null default '',
  add column if not exists carrier_vehicle text not null default '',
  add column if not exists carrier_phone text not null default '',
  add column if not exists shipment text not null default 'vehicle' check (shipment in ('vehicle','bulk')),
  add column if not exists arrival_offset smallint check (arrival_offset is null or arrival_offset between 0 and 7);

-- 기사는 매일 바뀌므로 차량 기본 기사는 더 이상 쓰지 않는다 (기존 값은 비움)
update vehicles set default_driver_id = null where default_driver_id is not null;

-- ===== 20261022000006_driver_team.sql =====
-- 기사 팀 (기사 선택 목록을 팀별로 묶어 보여 줌. 비우면 근무조로 묶음)
alter table drivers add column if not exists team text not null default '';

-- ===== 20261022000007_field_site_zone.sql =====
-- 현장 근무지를 일정표의 육지 / 제주 표 중 어디 아래에 보일지
alter table field_sites add column if not exists zone text check (zone in ('land', 'jeju'));
update field_sites set zone = case when name like '%목포%' then 'land' else 'jeju' end where zone is null;

-- ===== 20261022000008_load_driver_seq.sql =====
-- 오후(상차) 기사를 오전(하차) 기사와 따로 지정 + 기사의 그날 처리 순서 (1번차·2번차…)
alter table vehicle_days add column if not exists load_driver_id uuid references drivers on delete set null;
alter table vehicle_days add column if not exists unload_seq smallint;
alter table vehicle_days add column if not exists load_seq smallint;

-- 오후만 맡은 기사도 그 차량 주행거리를 입력할 수 있게
drop policy if exists "driver odometer" on odometer_logs;
create policy "driver odometer" on odometer_logs for insert to authenticated with check (
  exists (select 1 from vehicles v where v.id = vehicle_id and v.default_driver_id = my_driver_id())
  or exists (select 1 from vehicle_days d where d.vehicle_id = odometer_logs.vehicle_id
             and (d.driver_id = my_driver_id() or d.load_driver_id = my_driver_id()))
);

-- 기사 알림: 출발(하행·오후) 선박 변경은 오후 기사에게, 상차 오더 변경도 오후 기사에게
create or replace function notify_driver_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  drv uuid;
  msg text;
  zone_label text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.date < (now() at time zone 'Asia/Seoul')::date then return null; end if;

  if tg_table_name = 'vehicle_days' then
    if tg_op <> 'UPDATE' then return null; end if;
    zone_label := case when new.zone = 'jeju' then '오후 선박' else '하행선박' end;
    if new.departure_ship is distinct from old.departure_ship then
      drv := coalesce(new.load_driver_id, new.driver_id);
      msg := format('%s %s로 변경', zone_label, coalesce(trim(new.departure_ship_tag || ' ' || new.departure_ship), '없음'));
    elsif new.arrival_ship is distinct from old.arrival_ship then
      drv := new.driver_id;
      msg := format('%s %s로 변경', case when new.zone = 'jeju' then '도착 선박' else '상행선박' end,
                    coalesce(trim(new.arrival_ship_tag || ' ' || new.arrival_ship), '없음'));
    else
      return null;
    end if;
    if drv is null then return null; end if;
  else
    drv := coalesce(r.driver_id, (select case when r.kind = 'load' then coalesce(d.load_driver_id, d.driver_id) else d.driver_id end
                                    from vehicle_days d where d.date = r.date and d.vehicle_id = r.vehicle_id));
    if drv is null then return null; end if;
    msg := format('%s %s %s',
      case when r.kind = 'load' then '상차' else '하차' end,
      coalesce((select name from clients c where c.id = r.client_id), r.client_text, ''),
      case tg_op when 'INSERT' then '추가' when 'DELETE' then '취소' else '변경' end);
    if tg_op = 'UPDATE' and new.departure_ship is distinct from old.departure_ship then
      msg := format('상차 선박 %s로 변경', coalesce(new.departure_ship, '없음'));
    end if;
  end if;

  insert into notices (date, vehicle_id, driver_id, message) values (r.date, r.vehicle_id, drv, msg);
  return null;
end $$;

-- ===== 20261023000009_helper_driver.sql =====
-- 한 차량에 기사 2명: 동승 기사 (선탑·교육 / 지원)
alter table vehicle_days add column if not exists helper_driver_id uuid references drivers on delete set null;
alter table vehicle_days add column if not exists helper_role text not null default '' check (helper_role in ('', '선탑', '지원'));

-- ===== 20261023000010_start_time_place.sql =====
-- 출근 시간·장소 (제주: 부두, 차고지, 본사, 함덕, 고산, 현장 …)
alter table vehicle_days add column if not exists start_time text not null default '';
alter table vehicle_days add column if not exists start_place text not null default '';

-- ===== 20261023000011_driver_zone.sql =====
-- 직원·기사 근무 지역 (일정표 휴무 줄을 육지·제주로 나눔)
alter table drivers add column if not exists zone text check (zone in ('land', 'jeju'));
update drivers set zone = case when (shift || ' ' || affiliation) ~ '(상주|부산|서울|목포)' then 'land' else 'jeju' end where zone is null;

-- ===== 20261023000012_order_work_detail.sql =====
-- 상·하차 세부: 작업 시간과 내용 (예: 08:40 하차 · 막걸리공병 하차지원)
alter table daily_orders add column if not exists work_time text not null default '';
alter table daily_orders add column if not exists work_detail text not null default '';

-- ===== 20261024000013_driver_unlisted.sql =====
-- 비지정 근무자: 자유롭게 일해서 일정표 근무·대기·휴무 명단에 넣지 않음
alter table drivers add column if not exists unlisted boolean not null default false;

-- ===== 20261024000014_order_ship_date.sql =====
-- 선박 "대기"로 상차한 짐을 실제로 배에 싣는 날 (비우면 상차일)
alter table daily_orders add column if not exists ship_date date;

-- ===== 20261024000015_vehicle_day_notes.sql =====
-- 오전(하차)·오후(상차) 칸에 오더 없이 적는 비고
alter table vehicle_days add column if not exists unload_note text not null default '';
alter table vehicle_days add column if not exists load_note text not null default '';

-- ===== 20261025000016_driver_pay_rates.sql =====
-- 개인별 근로계약 근무별 수당 (원). 금액이라 관리자·배차만 읽고 쓴다 (기사·조회 계정에는 내려가지 않음)
create table driver_pay_rates (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null unique references drivers on delete cascade,
  rates jsonb not null default '{}',   -- {"주간근무": 120000, "야간근무": 150000, …}
  memo text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create trigger touch before insert or update on driver_pay_rates for each row execute function touch_row();
create trigger audit after insert or update or delete on driver_pay_rates for each row execute function audit_row();
alter table driver_pay_rates enable row level security;
alter table driver_pay_rates replica identity full;
alter publication supabase_realtime add table driver_pay_rates;
create policy "staff all" on driver_pay_rates for all to authenticated using (is_staff()) with check (is_staff());

-- ===== 20261025000017_day_status_overtime.sql =====
-- 근무현황: "근무일 아님" 지정, 시간외근무 시간, 그날 시간외 금액(관리자·배차 전용)
alter table driver_work_logs add column if not exists day_status text not null default '' check (day_status in ('', 'nonwork'));
alter table driver_work_logs add column if not exists overtime_hours numeric;

create table if not exists driver_day_pay (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  driver_id uuid not null references drivers on delete cascade,
  amount numeric not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (driver_id, date)
);
create index if not exists driver_day_pay_date on driver_day_pay (date);

create trigger touch before insert or update on driver_day_pay for each row execute function touch_row();
create trigger audit after insert or update or delete on driver_day_pay for each row execute function audit_row();
alter table driver_day_pay enable row level security;
alter table driver_day_pay replica identity full;
alter publication supabase_realtime add table driver_day_pay;
create policy "staff all" on driver_day_pay for all to authenticated using (is_staff()) with check (is_staff());

-- ===== 20261025000018_account_admin.sql =====
-- 회원 관리: 계정 막기(퇴사), 관리자용 사용자 목록(이메일·가입일·최근 로그인), 관리자 비밀번호 재설정

alter table profiles add column if not exists blocked boolean not null default false;

-- 막힌 계정은 'blocked' → 관리자·배차 권한 없음
create or replace function app_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select case when blocked then 'blocked' else role end from profiles where id = auth.uid()), 'viewer')
$$;

create or replace function is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select not coalesce((select blocked from profiles where id = auth.uid()), false)
$$;

create or replace function my_driver_id() returns uuid
language sql stable security definer set search_path = public as $$
  select driver_id from profiles where id = auth.uid() and not blocked
$$;

-- 읽기 정책: 막힌 계정은 아무것도 못 읽는다
do $$
declare r record;
begin
  for r in select tablename from pg_policies where schemaname = 'public' and policyname = 'read' loop
    execute format('drop policy "read" on %I', r.tablename);
    execute format('create policy "read" on %I for select to authenticated using (is_active())', r.tablename);
  end loop;
end $$;
drop policy if exists "photos read" on storage.objects;
create policy "photos read" on storage.objects for select to authenticated using (bucket_id = 'photos' and is_active());

-- 관리자: 사용자 목록 (이메일·가입일·최근 로그인은 auth.users 에만 있음)
create or replace function admin_users()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if app_role() <> 'admin' then raise exception '관리자만 볼 수 있습니다'; end if;
  return query select u.id, u.email::text, u.created_at, u.last_sign_in_at from auth.users u order by u.created_at;
end $$;

-- 관리자: 비밀번호 재설정 (메일 없이 새 비밀번호를 정해 알려 준다)
create or replace function admin_set_password(target uuid, new_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if app_role() <> 'admin' then raise exception '관리자만 바꿀 수 있습니다'; end if;
  if length(coalesce(new_password, '')) < 6 then raise exception '비밀번호는 6자 이상이어야 합니다'; end if;
  update auth.users set encrypted_password = crypt(new_password, gen_salt('bf')), updated_at = now() where id = target;
  if not found then raise exception '사용자를 찾을 수 없습니다'; end if;
end $$;

revoke execute on function admin_users() from public, anon;
revoke execute on function admin_set_password(uuid, text) from public, anon;
grant execute on function admin_users() to authenticated;
grant execute on function admin_set_password(uuid, text) to authenticated;

-- ===== 20261025000019_quick_repair.sql =====
-- 수리 시간 구분: quick = 경미(1시간 내, 운행 계속) / am = 오전 반나절 / pm = 오후 반나절 / full = 하루 이상(기간 동안 수리)
alter table maintenance_records add column if not exists repair_span text not null default 'full'
  check (repair_span in ('quick', 'am', 'pm', 'full'));

-- ===== 20261025000020_daily_server_backup.sql =====
-- 매일 새벽 2시(KST) 서버 자동 백업: 전체 데이터를 앱 백업 파일과 같은 모양(jsonb)으로 server_backups 에 30일 보관.
-- 휴대폰·PC가 꺼져 있어도 Supabase 안에서 돈다. 관리자는 설정 → 데이터 보관에서 날짜별로 내려받을 수 있다.

create extension if not exists pg_cron;

create table if not exists server_backups (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  summary text not null default '',
  size_bytes integer not null default 0,
  data jsonb not null
);
alter table server_backups enable row level security;
drop policy if exists "admin read" on server_backups;
create policy "admin read" on server_backups for select to authenticated using (app_role() = 'admin');

-- 앱 백업 파일 형식: { app, version, exported_at, snapshot: { 표이름: [행…] } }
create or replace function make_server_backup() returns bigint
language plpgsql security definer set search_path = public as $$
declare
  t text;
  rows jsonb;
  snap jsonb := '{}';
  doc jsonb;
  new_id bigint;
begin
  foreach t in array array[
    'clients','products','product_pricing','product_photos','product_suggestions',
    'vehicles','drivers','driver_work_logs','driver_pay_rates','driver_day_pay','ships','daily_orders','vehicle_days','recurring_orders',
    'recurring_order_versions','order_revenue','field_sites','field_assignments',
    'recurring_field_work','recurring_field_versions','maintenance_records',
    'maintenance_schedules','odometer_logs','settings','notices'
  ] loop
    begin
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from %I x', t) into rows;
    exception when undefined_table then
      rows := '[]'::jsonb; -- 아직 만들지 않은 표는 빈 목록
    end;
    snap := snap || jsonb_build_object(t, rows);
  end loop;
  doc := jsonb_build_object('app', 'gyeongmin-dispatch', 'version', 1, 'exported_at', to_jsonb(now()), 'snapshot', snap);
  insert into server_backups (summary, size_bytes, data)
  values (
    format('거래처 %s · 품목 %s · 차량 %s · 직원 %s · 오더 %s',
      jsonb_array_length(snap->'clients'), jsonb_array_length(snap->'products'), jsonb_array_length(snap->'vehicles'),
      jsonb_array_length(snap->'drivers'), jsonb_array_length(snap->'daily_orders')),
    octet_length(doc::text), doc)
  returning id into new_id;
  delete from server_backups where created_at < now() - interval '30 days';
  return new_id;
end $$;
revoke execute on function make_server_backup() from public, anon, authenticated;

-- 관리자: 지금 바로 백업
create or replace function admin_backup_now() returns bigint
language plpgsql security definer set search_path = public as $$
begin
  if app_role() <> 'admin' then raise exception '관리자만 할 수 있습니다'; end if;
  return make_server_backup();
end $$;
revoke execute on function admin_backup_now() from public, anon;
grant execute on function admin_backup_now() to authenticated;

-- pg_cron 은 UTC: 17:00 UTC = 다음 날 02:00 KST
select cron.unschedule(jobid) from cron.job where jobname = 'daily-server-backup';
select cron.schedule('daily-server-backup', '0 17 * * *', $$select make_server_backup()$$);

-- ===== 20261025000021_am_label.sql =====
-- 오전(하차) 기사 칸에 이름 대신 적는 말: "오후도착" (배가 오후에 들어와 오전 일이 없음)
alter table vehicle_days add column if not exists am_label text not null default '';

-- ===== 20261025000022_profile_info.sql =====
-- 회원 정보: 연락처 · 비상 연락처 · 추가 정보. 본인은 이 칸과 이름만 고칠 수 있다 (권한·기사 연결·막기는 관리자만)
alter table profiles add column if not exists phone text not null default '';
alter table profiles add column if not exists emergency_phone text not null default '';
alter table profiles add column if not exists memo text not null default '';

create or replace function update_my_profile(p_name text, p_phone text, p_emergency_phone text, p_memo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if not is_active() then raise exception '사용이 중지된 계정입니다'; end if;
  update profiles set
    name = coalesce(nullif(trim(p_name), ''), name),
    phone = coalesce(trim(p_phone), ''),
    emergency_phone = coalesce(trim(p_emergency_phone), ''),
    memo = coalesce(p_memo, '')
  where id = auth.uid();
  -- 기사와 연결된 계정이면 기사 명단의 연락처도 같이 맞춘다
  if coalesce(trim(p_phone), '') <> '' then
    update drivers set phone = trim(p_phone) where id = my_driver_id();
  end if;
end $$;
revoke execute on function update_my_profile(text, text, text, text) from public, anon;
grant execute on function update_my_profile(text, text, text, text) to authenticated;

-- ===== 20261025000023_ship_fares.sql =====
-- 선박 운임: 선박(·차종)별 기본 / 공차 / 할증 + 기사 승선 금액 (관리자·배차만). 배편마다 요금 구분·승선 여부
create table if not exists ship_fares (
  id uuid primary key default gen_random_uuid(),
  ship_id uuid not null references ships on delete cascade,
  vehicle_type text not null default '',   -- 빈 글자 = 모든 차종 기본값
  base numeric,
  empty numeric,
  surcharge numeric,
  boarding numeric,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (ship_id, vehicle_type)
);
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'touch' and tgrelid = 'ship_fares'::regclass) then
    create trigger touch before insert or update on ship_fares for each row execute function touch_row();
    create trigger audit after insert or update or delete on ship_fares for each row execute function audit_row();
    alter publication supabase_realtime add table ship_fares;
  end if;
end $$;
alter table ship_fares enable row level security;
alter table ship_fares replica identity full;
drop policy if exists "staff all" on ship_fares;
create policy "staff all" on ship_fares for all to authenticated using (is_staff()) with check (is_staff());

alter table vehicle_days add column if not exists fare_kind text not null default '' check (fare_kind in ('', 'base', 'empty', 'surcharge'));
alter table vehicle_days add column if not exists boarding boolean not null default false;

-- 서버 자동 백업에 선박 운임 포함
-- 앱 백업 파일 형식: { app, version, exported_at, snapshot: { 표이름: [행…] } }
create or replace function make_server_backup() returns bigint
language plpgsql security definer set search_path = public as $$
declare
  t text;
  rows jsonb;
  snap jsonb := '{}';
  doc jsonb;
  new_id bigint;
begin
  foreach t in array array[
    'clients','products','product_pricing','product_photos','product_suggestions',
    'vehicles','drivers','driver_work_logs','driver_pay_rates','driver_day_pay','ships','ship_fares','daily_orders','vehicle_days','recurring_orders',
    'recurring_order_versions','order_revenue','field_sites','field_assignments',
    'recurring_field_work','recurring_field_versions','maintenance_records',
    'maintenance_schedules','odometer_logs','settings','notices'
  ] loop
    begin
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from %I x', t) into rows;
    exception when undefined_table then
      rows := '[]'::jsonb; -- 아직 만들지 않은 표는 빈 목록
    end;
    snap := snap || jsonb_build_object(t, rows);
  end loop;
  doc := jsonb_build_object('app', 'gyeongmin-dispatch', 'version', 1, 'exported_at', to_jsonb(now()), 'snapshot', snap);
  insert into server_backups (summary, size_bytes, data)
  values (
    format('거래처 %s · 품목 %s · 차량 %s · 직원 %s · 오더 %s',
      jsonb_array_length(snap->'clients'), jsonb_array_length(snap->'products'), jsonb_array_length(snap->'vehicles'),
      jsonb_array_length(snap->'drivers'), jsonb_array_length(snap->'daily_orders')),
    octet_length(doc::text), doc)
  returning id into new_id;
  delete from server_backups where created_at < now() - interval '30 days';
  return new_id;
end $$;

-- ===== 20261025000024_product_bulk_fees.sql =====
-- 품목별 벌크(화물만 선적) 요금: 파렛트당·대당 = 수량 × 요금, 금액 직접 = 건당 (관리자·배차만)
create table if not exists product_bulk_fees (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references products on delete cascade,
  calc_method text not null default 'per_pallet' check (calc_method in ('per_pallet','per_unit','fixed')),
  fee numeric not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'touch' and tgrelid = 'product_bulk_fees'::regclass) then
    create trigger touch before insert or update on product_bulk_fees for each row execute function touch_row();
    create trigger audit after insert or update or delete on product_bulk_fees for each row execute function audit_row();
    alter publication supabase_realtime add table product_bulk_fees;
  end if;
end $$;
alter table product_bulk_fees enable row level security;
alter table product_bulk_fees replica identity full;
drop policy if exists "staff all" on product_bulk_fees;
create policy "staff all" on product_bulk_fees for all to authenticated using (is_staff()) with check (is_staff());

-- 서버 자동 백업에 벌크 요금 포함
-- 앱 백업 파일 형식: { app, version, exported_at, snapshot: { 표이름: [행…] } }
create or replace function make_server_backup() returns bigint
language plpgsql security definer set search_path = public as $$
declare
  t text;
  rows jsonb;
  snap jsonb := '{}';
  doc jsonb;
  new_id bigint;
begin
  foreach t in array array[
    'clients','products','product_pricing','product_photos','product_suggestions',
    'vehicles','drivers','driver_work_logs','driver_pay_rates','driver_day_pay','ships','ship_fares','product_bulk_fees','daily_orders','vehicle_days','recurring_orders',
    'recurring_order_versions','order_revenue','field_sites','field_assignments',
    'recurring_field_work','recurring_field_versions','maintenance_records',
    'maintenance_schedules','odometer_logs','settings','notices'
  ] loop
    begin
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from %I x', t) into rows;
    exception when undefined_table then
      rows := '[]'::jsonb; -- 아직 만들지 않은 표는 빈 목록
    end;
    snap := snap || jsonb_build_object(t, rows);
  end loop;
  doc := jsonb_build_object('app', 'gyeongmin-dispatch', 'version', 1, 'exported_at', to_jsonb(now()), 'snapshot', snap);
  insert into server_backups (summary, size_bytes, data)
  values (
    format('거래처 %s · 품목 %s · 차량 %s · 직원 %s · 오더 %s',
      jsonb_array_length(snap->'clients'), jsonb_array_length(snap->'products'), jsonb_array_length(snap->'vehicles'),
      jsonb_array_length(snap->'drivers'), jsonb_array_length(snap->'daily_orders')),
    octet_length(doc::text), doc)
  returning id into new_id;
  delete from server_backups where created_at < now() - interval '30 days';
  return new_id;
end $$;

-- ===== 20261025000025_delay_hold_notices.sql =====
-- 하차 연기 · 고객 지정일 하차(차량 대기 / 창고 보관) · 기사 알림 내용 자세히

alter table daily_orders add column if not exists delayed_from date;
alter table daily_orders add column if not exists unload_date date;
alter table daily_orders add column if not exists unload_hold text not null default '' check (unload_hold in ('', 'vehicle', 'storage'));

-- 기사 알림 한 줄 (기사가 없으면 안 남김)
create or replace function add_driver_notice(p_date date, p_vehicle uuid, p_driver uuid, p_msg text) returns void
language sql security definer set search_path = public as $$
  insert into notices (date, vehicle_id, driver_id, message)
  select p_date, p_vehicle, p_driver, p_msg where p_driver is not null and coalesce(p_msg, '') <> ''
$$;

-- 기사 본인 일정이 바뀌면 알림: "10/26 9915 하차 도민물류 감귤 10p 변경 (수량 10→8)"
create or replace function notify_driver_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  veh text;
  d text;
  un text;
  ld text;
  what text;
  changes text[] := '{}';
  drv uuid;
  old_drv uuid;
  kind_label text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.date < (now() at time zone 'Asia/Seoul')::date then return null; end if;
  veh := coalesce((select short_no from vehicles where id = r.vehicle_id), '');
  d := to_char(r.date, 'FMMM/FMDD');

  if tg_table_name = 'vehicle_days' then
    un := case when r.zone = 'jeju' then '오전' else '하차' end;
    ld := case when r.zone = 'jeju' then '오후' else '상차' end;
    -- 배차됨 / 빠짐
    if tg_op = 'INSERT' then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 배차됨', d, veh, case when new.load_driver_id is null or new.load_driver_id = new.driver_id then un || '·' || ld else un end));
      if new.load_driver_id is distinct from new.driver_id then
        perform add_driver_notice(r.date, r.vehicle_id, new.load_driver_id, format('%s %s %s 배차됨', d, veh, ld));
      end if;
      return null;
    end if;
    if tg_op <> 'UPDATE' then return null; end if;
    if new.driver_id is distinct from old.driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.driver_id, format('%s %s %s 배차 빠짐', d, veh, un));
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 배차됨', d, veh, un));
    end if;
    if new.load_driver_id is distinct from old.load_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.load_driver_id, format('%s %s %s 배차 빠짐', d, veh, ld));
      perform add_driver_notice(r.date, r.vehicle_id, new.load_driver_id, format('%s %s %s 배차됨', d, veh, ld));
    end if;
    if new.helper_driver_id is distinct from old.helper_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.helper_driver_id, format('%s %s 동승 빠짐', d, veh));
      perform add_driver_notice(r.date, r.vehicle_id, new.helper_driver_id, format('%s %s 동승(%s) 배정', d, veh, coalesce(nullif(new.helper_role, ''), '동승')));
    end if;
    if new.departure_ship is distinct from old.departure_ship then
      perform add_driver_notice(r.date, r.vehicle_id, coalesce(new.load_driver_id, new.driver_id),
        format('%s %s 출발 선박 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.departure_ship_tag, '') || ' ' || coalesce(new.departure_ship, '')), ''), '없음')));
    end if;
    if new.arrival_ship is distinct from old.arrival_ship then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id,
        format('%s %s 도착 선박 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.arrival_ship_tag, '') || ' ' || coalesce(new.arrival_ship, '')), ''), '없음')));
    end if;
    if new.start_time is distinct from old.start_time or new.start_place is distinct from old.start_place then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id,
        format('%s %s 출근 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.start_time, '') || ' ' || coalesce(new.start_place, '')), ''), '기본(07:00 부두)')));
    end if;
    if new.unload_note is distinct from old.unload_note and coalesce(new.unload_note, '') <> '' then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 비고: %s', d, veh, un, new.unload_note));
    end if;
    if new.load_note is distinct from old.load_note and coalesce(new.load_note, '') <> '' then
      perform add_driver_notice(r.date, r.vehicle_id, coalesce(new.load_driver_id, new.driver_id), format('%s %s %s 비고: %s', d, veh, ld, new.load_note));
    end if;
    return null;
  end if;

  -- daily_orders
  kind_label := case when r.kind = 'load' then '상차' else '하차' end;
  what := concat_ws(' ',
    nullif(coalesce((select name from clients c where c.id = r.client_id), r.client_text, ''), ''),
    nullif(coalesce((select name from products p where p.id = r.product_id), r.product_text, ''), ''),
    to_char(r.quantity, 'FM999999990.##') || coalesce(r.unit, ''));
  drv := coalesce(r.driver_id, (select case when r.kind = 'load' then coalesce(vd.load_driver_id, vd.driver_id) else vd.driver_id end
                                 from vehicle_days vd where vd.date = r.date and vd.vehicle_id = r.vehicle_id));
  if tg_op = 'INSERT' then
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 추가: %s', d, veh, kind_label, what));
  elsif tg_op = 'DELETE' then
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 취소: %s', d, veh, kind_label, what));
  else
    -- 다른 차량·날짜로 옮겨짐: 이전 기사에게는 빠짐
    if new.vehicle_id is distinct from old.vehicle_id or new.date is distinct from old.date then
      old_drv := coalesce(old.driver_id, (select case when old.kind = 'load' then coalesce(vd.load_driver_id, vd.driver_id) else vd.driver_id end
                                         from vehicle_days vd where vd.date = old.date and vd.vehicle_id = old.vehicle_id));
      if old_drv is distinct from drv or new.date is distinct from old.date then
        perform add_driver_notice(old.date, old.vehicle_id, old_drv,
          case when new.delayed_from = old.date
            then format('%s %s %s 연기 → %s: %s', to_char(old.date, 'FMMM/FMDD'), coalesce((select short_no from vehicles where id = old.vehicle_id), ''), kind_label, d, what)
            else format('%s %s %s 빠짐: %s%s', to_char(old.date, 'FMMM/FMDD'), coalesce((select short_no from vehicles where id = old.vehicle_id), ''), kind_label, what,
                        case when new.date is distinct from old.date then format(' (→ %s)', d) else '' end) end);
        perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 추가: %s', d, veh, kind_label, what));
        return null;
      end if;
    end if;
    if new.quantity is distinct from old.quantity or new.unit is distinct from old.unit then
      changes := changes || format('수량 %s→%s', coalesce(to_char(old.quantity, 'FM999999990.##'), '-'), coalesce(to_char(new.quantity, 'FM999999990.##') || coalesce(new.unit, ''), '-'));
    end if;
    if new.product_id is distinct from old.product_id or new.product_text is distinct from old.product_text then changes := changes || '품목'::text; end if;
    if new.client_id is distinct from old.client_id or new.client_text is distinct from old.client_text then changes := changes || '거래처'::text; end if;
    if new.work_time is distinct from old.work_time then changes := changes || format('시간 %s', coalesce(nullif(new.work_time, ''), '없음')); end if;
    if new.work_detail is distinct from old.work_detail then changes := changes || format('작업 %s', coalesce(nullif(new.work_detail, ''), '없음')); end if;
    if new.memo is distinct from old.memo then changes := changes || format('비고 %s', coalesce(nullif(new.memo, ''), '없음')); end if;
    if new.pickup_place is distinct from old.pickup_place then changes := changes || format('상차지 %s', coalesce(nullif(new.pickup_place, ''), '없음')); end if;
    if new.dropoff_place is distinct from old.dropoff_place then changes := changes || format('하차지 %s', coalesce(nullif(new.dropoff_place, ''), '없음')); end if;
    if new.departure_ship is distinct from old.departure_ship then changes := changes || format('선박 %s', coalesce(new.departure_ship, '없음')); end if;
    if new.unload_date is distinct from old.unload_date then changes := changes || format('지정 하차일 %s', coalesce(to_char(new.unload_date, 'FMMM/FMDD'), '없음')); end if;
    if array_length(changes, 1) is null then return null; end if; -- 기사와 상관없는 변경(금액 등)
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s %s 변경 (%s)', d, veh, kind_label, what, array_to_string(changes, ', ')));
  end if;
  return null;
end $$;

drop trigger if exists driver_notice on vehicle_days;
create trigger driver_notice after insert or update on vehicle_days for each row execute function notify_driver_change();
drop trigger if exists driver_notice on daily_orders;
create trigger driver_notice after insert or update or delete on daily_orders for each row execute function notify_driver_change();

-- ===== 20261026000026_field_part.sql =====
-- 현장근무 시간: 빈 글자 = 종일, am = 오전만, pm = 오후만 (현장 직원이 반나절 기사 배차, 기사가 반나절 현장 지원)
alter table field_assignments add column if not exists part text not null default '' check (part in ('', 'am', 'pm'));

-- ===== 20261026000027_night_work.sql =====
-- 야간 작업 · 야간 기사 (오후 제주 하차 → 육지 야간 상차 → 다시 내려옴, 제주 야간 상차 → 아침 배 등)
alter table daily_orders add column if not exists night boolean not null default false;
alter table vehicle_days add column if not exists night_driver_id uuid references drivers on delete set null;

-- 기사 본인 일정이 바뀌면 알림: "10/26 9915 하차 도민물류 감귤 10p 변경 (수량 10→8)"
create or replace function notify_driver_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  veh text;
  d text;
  un text;
  ld text;
  what text;
  changes text[] := '{}';
  drv uuid;
  old_drv uuid;
  kind_label text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.date < (now() at time zone 'Asia/Seoul')::date then return null; end if;
  veh := coalesce((select short_no from vehicles where id = r.vehicle_id), '');
  d := to_char(r.date, 'FMMM/FMDD');

  if tg_table_name = 'vehicle_days' then
    un := case when r.zone = 'jeju' then '오전' else '하차' end;
    ld := case when r.zone = 'jeju' then '오후' else '상차' end;
    -- 배차됨 / 빠짐
    if tg_op = 'INSERT' then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 배차됨', d, veh, case when new.load_driver_id is null or new.load_driver_id = new.driver_id then un || '·' || ld else un end));
      if new.load_driver_id is distinct from new.driver_id then
        perform add_driver_notice(r.date, r.vehicle_id, new.load_driver_id, format('%s %s %s 배차됨', d, veh, ld));
      end if;
      perform add_driver_notice(r.date, r.vehicle_id, new.night_driver_id, format('%s %s 야간 배차됨', d, veh));
      return null;
    end if;
    if tg_op <> 'UPDATE' then return null; end if;
    if new.driver_id is distinct from old.driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.driver_id, format('%s %s %s 배차 빠짐', d, veh, un));
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 배차됨', d, veh, un));
    end if;
    if new.load_driver_id is distinct from old.load_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.load_driver_id, format('%s %s %s 배차 빠짐', d, veh, ld));
      perform add_driver_notice(r.date, r.vehicle_id, new.load_driver_id, format('%s %s %s 배차됨', d, veh, ld));
    end if;
    if new.night_driver_id is distinct from old.night_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.night_driver_id, format('%s %s 야간 배차 빠짐', d, veh));
      perform add_driver_notice(r.date, r.vehicle_id, new.night_driver_id, format('%s %s 야간 배차됨', d, veh));
    end if;
    if new.helper_driver_id is distinct from old.helper_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.helper_driver_id, format('%s %s 동승 빠짐', d, veh));
      perform add_driver_notice(r.date, r.vehicle_id, new.helper_driver_id, format('%s %s 동승(%s) 배정', d, veh, coalesce(nullif(new.helper_role, ''), '동승')));
    end if;
    if new.departure_ship is distinct from old.departure_ship then
      perform add_driver_notice(r.date, r.vehicle_id, coalesce(new.load_driver_id, new.driver_id),
        format('%s %s 출발 선박 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.departure_ship_tag, '') || ' ' || coalesce(new.departure_ship, '')), ''), '없음')));
    end if;
    if new.arrival_ship is distinct from old.arrival_ship then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id,
        format('%s %s 도착 선박 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.arrival_ship_tag, '') || ' ' || coalesce(new.arrival_ship, '')), ''), '없음')));
    end if;
    if new.start_time is distinct from old.start_time or new.start_place is distinct from old.start_place then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id,
        format('%s %s 출근 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.start_time, '') || ' ' || coalesce(new.start_place, '')), ''), '기본(07:00 부두)')));
    end if;
    if new.unload_note is distinct from old.unload_note and coalesce(new.unload_note, '') <> '' then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 비고: %s', d, veh, un, new.unload_note));
    end if;
    if new.load_note is distinct from old.load_note and coalesce(new.load_note, '') <> '' then
      perform add_driver_notice(r.date, r.vehicle_id, coalesce(new.load_driver_id, new.driver_id), format('%s %s %s 비고: %s', d, veh, ld, new.load_note));
    end if;
    return null;
  end if;

  -- daily_orders
  kind_label := case when r.night then '야간 ' else '' end || case when r.kind = 'load' then '상차' else '하차' end;
  what := concat_ws(' ',
    nullif(coalesce((select name from clients c where c.id = r.client_id), r.client_text, ''), ''),
    nullif(coalesce((select name from products p where p.id = r.product_id), r.product_text, ''), ''),
    to_char(r.quantity, 'FM999999990.##') || coalesce(r.unit, ''));
  drv := coalesce(r.driver_id, (select case when r.night then vd.night_driver_id when r.kind = 'load' then coalesce(vd.load_driver_id, vd.driver_id) else vd.driver_id end
                                 from vehicle_days vd where vd.date = r.date and vd.vehicle_id = r.vehicle_id));
  if tg_op = 'INSERT' then
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 추가: %s', d, veh, kind_label, what));
  elsif tg_op = 'DELETE' then
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 취소: %s', d, veh, kind_label, what));
  else
    -- 다른 차량·날짜로 옮겨짐: 이전 기사에게는 빠짐
    if new.vehicle_id is distinct from old.vehicle_id or new.date is distinct from old.date then
      old_drv := coalesce(old.driver_id, (select case when old.night then vd.night_driver_id when old.kind = 'load' then coalesce(vd.load_driver_id, vd.driver_id) else vd.driver_id end
                                         from vehicle_days vd where vd.date = old.date and vd.vehicle_id = old.vehicle_id));
      if old_drv is distinct from drv or new.date is distinct from old.date then
        perform add_driver_notice(old.date, old.vehicle_id, old_drv,
          case when new.delayed_from = old.date
            then format('%s %s %s 연기 → %s: %s', to_char(old.date, 'FMMM/FMDD'), coalesce((select short_no from vehicles where id = old.vehicle_id), ''), kind_label, d, what)
            else format('%s %s %s 빠짐: %s%s', to_char(old.date, 'FMMM/FMDD'), coalesce((select short_no from vehicles where id = old.vehicle_id), ''), kind_label, what,
                        case when new.date is distinct from old.date then format(' (→ %s)', d) else '' end) end);
        perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 추가: %s', d, veh, kind_label, what));
        return null;
      end if;
    end if;
    if new.quantity is distinct from old.quantity or new.unit is distinct from old.unit then
      changes := changes || format('수량 %s→%s', coalesce(to_char(old.quantity, 'FM999999990.##'), '-'), coalesce(to_char(new.quantity, 'FM999999990.##') || coalesce(new.unit, ''), '-'));
    end if;
    if new.product_id is distinct from old.product_id or new.product_text is distinct from old.product_text then changes := changes || '품목'::text; end if;
    if new.client_id is distinct from old.client_id or new.client_text is distinct from old.client_text then changes := changes || '거래처'::text; end if;
    if new.work_time is distinct from old.work_time then changes := changes || format('시간 %s', coalesce(nullif(new.work_time, ''), '없음')); end if;
    if new.work_detail is distinct from old.work_detail then changes := changes || format('작업 %s', coalesce(nullif(new.work_detail, ''), '없음')); end if;
    if new.memo is distinct from old.memo then changes := changes || format('비고 %s', coalesce(nullif(new.memo, ''), '없음')); end if;
    if new.pickup_place is distinct from old.pickup_place then changes := changes || format('상차지 %s', coalesce(nullif(new.pickup_place, ''), '없음')); end if;
    if new.dropoff_place is distinct from old.dropoff_place then changes := changes || format('하차지 %s', coalesce(nullif(new.dropoff_place, ''), '없음')); end if;
    if new.departure_ship is distinct from old.departure_ship then changes := changes || format('선박 %s', coalesce(new.departure_ship, '없음')); end if;
    if new.night is distinct from old.night then changes := changes || case when new.night then '야간으로'::text else '야간 해제'::text end; end if;
    if new.unload_date is distinct from old.unload_date then changes := changes || format('지정 하차일 %s', coalesce(to_char(new.unload_date, 'FMMM/FMDD'), '없음')); end if;
    if array_length(changes, 1) is null then return null; end if; -- 기사와 상관없는 변경(금액 등)
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s %s 변경 (%s)', d, veh, kind_label, what, array_to_string(changes, ', ')));
  end if;
  return null;
end $$;

drop trigger if exists driver_notice on vehicle_days;
create trigger driver_notice after insert or update on vehicle_days for each row execute function notify_driver_change();
drop trigger if exists driver_notice on daily_orders;
create trigger driver_notice after insert or update or delete on daily_orders for each row execute function notify_driver_change();

-- ===== 20261027000028_bulk_ships.sql =====
-- 벌크 선박: 차량은 안 타고 화물만 (도착지 하차는 차량 없이 배차 대기)
alter table ships add column if not exists bulk boolean not null default false;
update ships set bulk = true where name like '%벌크%' and not bulk;
-- 성우벌크 · 영진벌크 · 세주벌크가 아직 없으면 추가
insert into ships (name, departs_at, route, arrival_day_offset, sort_order, bulk)
select n, '', 'both', 1, (select coalesce(max(sort_order), 0) + 1 from ships), true
from unnest(array['성우벌크', '영진벌크', '세주벌크']) as n
where not exists (select 1 from ships s where s.name = n);

-- ===== 20261028000029_turn_vehicle.sql =====
-- 왕복 차량: 그날 다른 지역에 건너가 따로 배차 (원래 지역 줄은 그대로) · 건너간 쪽 하차·상차 기사
alter table vehicle_days add column if not exists turn boolean not null default false;
alter table vehicle_days add column if not exists turn_driver_id uuid references drivers on delete set null;
alter table vehicle_days add column if not exists turn_load_driver_id uuid references drivers on delete set null;

-- 기사 알림: 왕복 기사 배정·빠짐, 건너간 쪽 오더는 왕복 기사에게
create or replace function notify_driver_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  veh text;
  d text;
  un text;
  ld text;
  what text;
  changes text[] := '{}';
  drv uuid;
  old_drv uuid;
  kind_label text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.date < (now() at time zone 'Asia/Seoul')::date then return null; end if;
  veh := coalesce((select short_no from vehicles where id = r.vehicle_id), '');
  d := to_char(r.date, 'FMMM/FMDD');

  if tg_table_name = 'vehicle_days' then
    un := case when r.zone = 'jeju' then '오전' else '하차' end;
    ld := case when r.zone = 'jeju' then '오후' else '상차' end;
    -- 배차됨 / 빠짐
    if tg_op = 'INSERT' then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 배차됨', d, veh, case when new.load_driver_id is null or new.load_driver_id = new.driver_id then un || '·' || ld else un end));
      if new.load_driver_id is distinct from new.driver_id then
        perform add_driver_notice(r.date, r.vehicle_id, new.load_driver_id, format('%s %s %s 배차됨', d, veh, ld));
      end if;
      perform add_driver_notice(r.date, r.vehicle_id, new.night_driver_id, format('%s %s 야간 배차됨', d, veh));
      return null;
    end if;
    if tg_op <> 'UPDATE' then return null; end if;
    if new.driver_id is distinct from old.driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.driver_id, format('%s %s %s 배차 빠짐', d, veh, un));
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 배차됨', d, veh, un));
    end if;
    if new.load_driver_id is distinct from old.load_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.load_driver_id, format('%s %s %s 배차 빠짐', d, veh, ld));
      perform add_driver_notice(r.date, r.vehicle_id, new.load_driver_id, format('%s %s %s 배차됨', d, veh, ld));
    end if;
    if new.night_driver_id is distinct from old.night_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.night_driver_id, format('%s %s 야간 배차 빠짐', d, veh));
      perform add_driver_notice(r.date, r.vehicle_id, new.night_driver_id, format('%s %s 야간 배차됨', d, veh));
    end if;
    -- 왕복으로 건너간 쪽 기사
    if new.turn_driver_id is distinct from old.turn_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.turn_driver_id, format('%s %s 왕복 %s 배차 빠짐', d, veh, case when r.zone = 'jeju' then '하차' else '오전' end));
      perform add_driver_notice(r.date, r.vehicle_id, new.turn_driver_id, format('%s %s 왕복 %s 배차됨', d, veh, case when r.zone = 'jeju' then '하차' else '오전' end));
    end if;
    if new.turn_load_driver_id is distinct from old.turn_load_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.turn_load_driver_id, format('%s %s 왕복 %s 배차 빠짐', d, veh, case when r.zone = 'jeju' then '상차' else '오후' end));
      perform add_driver_notice(r.date, r.vehicle_id, new.turn_load_driver_id, format('%s %s 왕복 %s 배차됨', d, veh, case when r.zone = 'jeju' then '상차' else '오후' end));
    end if;
    if new.helper_driver_id is distinct from old.helper_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.helper_driver_id, format('%s %s 동승 빠짐', d, veh));
      perform add_driver_notice(r.date, r.vehicle_id, new.helper_driver_id, format('%s %s 동승(%s) 배정', d, veh, coalesce(nullif(new.helper_role, ''), '동승')));
    end if;
    if new.departure_ship is distinct from old.departure_ship then
      perform add_driver_notice(r.date, r.vehicle_id, coalesce(new.load_driver_id, new.driver_id),
        format('%s %s 출발 선박 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.departure_ship_tag, '') || ' ' || coalesce(new.departure_ship, '')), ''), '없음')));
    end if;
    if new.arrival_ship is distinct from old.arrival_ship then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id,
        format('%s %s 도착 선박 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.arrival_ship_tag, '') || ' ' || coalesce(new.arrival_ship, '')), ''), '없음')));
    end if;
    if new.start_time is distinct from old.start_time or new.start_place is distinct from old.start_place then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id,
        format('%s %s 출근 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.start_time, '') || ' ' || coalesce(new.start_place, '')), ''), '기본(07:00 부두)')));
    end if;
    if new.unload_note is distinct from old.unload_note and coalesce(new.unload_note, '') <> '' then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 비고: %s', d, veh, un, new.unload_note));
    end if;
    if new.load_note is distinct from old.load_note and coalesce(new.load_note, '') <> '' then
      perform add_driver_notice(r.date, r.vehicle_id, coalesce(new.load_driver_id, new.driver_id), format('%s %s %s 비고: %s', d, veh, ld, new.load_note));
    end if;
    return null;
  end if;

  -- daily_orders
  kind_label := case when r.night then '야간 ' else '' end || case when r.kind = 'load' then '상차' else '하차' end;
  what := concat_ws(' ',
    nullif(coalesce((select name from clients c where c.id = r.client_id), r.client_text, ''), ''),
    nullif(coalesce((select name from products p where p.id = r.product_id), r.product_text, ''), ''),
    to_char(r.quantity, 'FM999999990.##') || coalesce(r.unit, ''));
  drv := coalesce(r.driver_id, (select case when r.night then vd.night_driver_id when vd.zone is not null and r.zone <> vd.zone then case when r.kind = 'load' then vd.turn_load_driver_id else vd.turn_driver_id end when r.kind = 'load' then coalesce(vd.load_driver_id, vd.driver_id) else vd.driver_id end
                                 from vehicle_days vd where vd.date = r.date and vd.vehicle_id = r.vehicle_id));
  if tg_op = 'INSERT' then
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 추가: %s', d, veh, kind_label, what));
  elsif tg_op = 'DELETE' then
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 취소: %s', d, veh, kind_label, what));
  else
    -- 다른 차량·날짜로 옮겨짐: 이전 기사에게는 빠짐
    if new.vehicle_id is distinct from old.vehicle_id or new.date is distinct from old.date then
      old_drv := coalesce(old.driver_id, (select case when old.night then vd.night_driver_id when vd.zone is not null and old.zone <> vd.zone then case when old.kind = 'load' then vd.turn_load_driver_id else vd.turn_driver_id end when old.kind = 'load' then coalesce(vd.load_driver_id, vd.driver_id) else vd.driver_id end
                                         from vehicle_days vd where vd.date = old.date and vd.vehicle_id = old.vehicle_id));
      if old_drv is distinct from drv or new.date is distinct from old.date then
        perform add_driver_notice(old.date, old.vehicle_id, old_drv,
          case when new.delayed_from = old.date
            then format('%s %s %s 연기 → %s: %s', to_char(old.date, 'FMMM/FMDD'), coalesce((select short_no from vehicles where id = old.vehicle_id), ''), kind_label, d, what)
            else format('%s %s %s 빠짐: %s%s', to_char(old.date, 'FMMM/FMDD'), coalesce((select short_no from vehicles where id = old.vehicle_id), ''), kind_label, what,
                        case when new.date is distinct from old.date then format(' (→ %s)', d) else '' end) end);
        perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 추가: %s', d, veh, kind_label, what));
        return null;
      end if;
    end if;
    if new.quantity is distinct from old.quantity or new.unit is distinct from old.unit then
      changes := changes || format('수량 %s→%s', coalesce(to_char(old.quantity, 'FM999999990.##'), '-'), coalesce(to_char(new.quantity, 'FM999999990.##') || coalesce(new.unit, ''), '-'));
    end if;
    if new.product_id is distinct from old.product_id or new.product_text is distinct from old.product_text then changes := changes || '품목'::text; end if;
    if new.client_id is distinct from old.client_id or new.client_text is distinct from old.client_text then changes := changes || '거래처'::text; end if;
    if new.work_time is distinct from old.work_time then changes := changes || format('시간 %s', coalesce(nullif(new.work_time, ''), '없음')); end if;
    if new.work_detail is distinct from old.work_detail then changes := changes || format('작업 %s', coalesce(nullif(new.work_detail, ''), '없음')); end if;
    if new.memo is distinct from old.memo then changes := changes || format('비고 %s', coalesce(nullif(new.memo, ''), '없음')); end if;
    if new.pickup_place is distinct from old.pickup_place then changes := changes || format('상차지 %s', coalesce(nullif(new.pickup_place, ''), '없음')); end if;
    if new.dropoff_place is distinct from old.dropoff_place then changes := changes || format('하차지 %s', coalesce(nullif(new.dropoff_place, ''), '없음')); end if;
    if new.departure_ship is distinct from old.departure_ship then changes := changes || format('선박 %s', coalesce(new.departure_ship, '없음')); end if;
    if new.night is distinct from old.night then changes := changes || case when new.night then '야간으로'::text else '야간 해제'::text end; end if;
    if new.unload_date is distinct from old.unload_date then changes := changes || format('지정 하차일 %s', coalesce(to_char(new.unload_date, 'FMMM/FMDD'), '없음')); end if;
    if array_length(changes, 1) is null then return null; end if; -- 기사와 상관없는 변경(금액 등)
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s %s 변경 (%s)', d, veh, kind_label, what, array_to_string(changes, ', ')));
  end if;
  return null;
end $$;

drop trigger if exists driver_notice on vehicle_days;
create trigger driver_notice after insert or update on vehicle_days for each row execute function notify_driver_change();
drop trigger if exists driver_notice on daily_orders;
create trigger driver_notice after insert or update or delete on daily_orders for each row execute function notify_driver_change();

-- ===== 20261028000030_turn_ship.sql =====
-- 연속운행(왕복) 차량: 건너간 쪽 상차(오후) 뒤 타는 배 · 알림 문구 "연속운행"
alter table vehicle_days add column if not exists turn_departure_ship text;
alter table vehicle_days add column if not exists turn_departure_ship_tag text not null default '';

create or replace function notify_driver_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  veh text;
  d text;
  un text;
  ld text;
  what text;
  changes text[] := '{}';
  drv uuid;
  old_drv uuid;
  kind_label text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.date < (now() at time zone 'Asia/Seoul')::date then return null; end if;
  veh := coalesce((select short_no from vehicles where id = r.vehicle_id), '');
  d := to_char(r.date, 'FMMM/FMDD');

  if tg_table_name = 'vehicle_days' then
    un := case when r.zone = 'jeju' then '오전' else '하차' end;
    ld := case when r.zone = 'jeju' then '오후' else '상차' end;
    -- 배차됨 / 빠짐
    if tg_op = 'INSERT' then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 배차됨', d, veh, case when new.load_driver_id is null or new.load_driver_id = new.driver_id then un || '·' || ld else un end));
      if new.load_driver_id is distinct from new.driver_id then
        perform add_driver_notice(r.date, r.vehicle_id, new.load_driver_id, format('%s %s %s 배차됨', d, veh, ld));
      end if;
      perform add_driver_notice(r.date, r.vehicle_id, new.night_driver_id, format('%s %s 야간 배차됨', d, veh));
      return null;
    end if;
    if tg_op <> 'UPDATE' then return null; end if;
    if new.driver_id is distinct from old.driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.driver_id, format('%s %s %s 배차 빠짐', d, veh, un));
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 배차됨', d, veh, un));
    end if;
    if new.load_driver_id is distinct from old.load_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.load_driver_id, format('%s %s %s 배차 빠짐', d, veh, ld));
      perform add_driver_notice(r.date, r.vehicle_id, new.load_driver_id, format('%s %s %s 배차됨', d, veh, ld));
    end if;
    if new.night_driver_id is distinct from old.night_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.night_driver_id, format('%s %s 야간 배차 빠짐', d, veh));
      perform add_driver_notice(r.date, r.vehicle_id, new.night_driver_id, format('%s %s 야간 배차됨', d, veh));
    end if;
    -- 연속운행으로 건너간 쪽 기사
    if new.turn_driver_id is distinct from old.turn_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.turn_driver_id, format('%s %s 연속운행 %s 배차 빠짐', d, veh, case when r.zone = 'jeju' then '하차' else '오전' end));
      perform add_driver_notice(r.date, r.vehicle_id, new.turn_driver_id, format('%s %s 연속운행 %s 배차됨', d, veh, case when r.zone = 'jeju' then '하차' else '오전' end));
    end if;
    if new.turn_load_driver_id is distinct from old.turn_load_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.turn_load_driver_id, format('%s %s 연속운행 %s 배차 빠짐', d, veh, case when r.zone = 'jeju' then '상차' else '오후' end));
      perform add_driver_notice(r.date, r.vehicle_id, new.turn_load_driver_id, format('%s %s 연속운행 %s 배차됨', d, veh, case when r.zone = 'jeju' then '상차' else '오후' end));
    end if;
    if new.helper_driver_id is distinct from old.helper_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.helper_driver_id, format('%s %s 동승 빠짐', d, veh));
      perform add_driver_notice(r.date, r.vehicle_id, new.helper_driver_id, format('%s %s 동승(%s) 배정', d, veh, coalesce(nullif(new.helper_role, ''), '동승')));
    end if;
    if new.departure_ship is distinct from old.departure_ship then
      perform add_driver_notice(r.date, r.vehicle_id, coalesce(new.load_driver_id, new.driver_id),
        format('%s %s 출발 선박 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.departure_ship_tag, '') || ' ' || coalesce(new.departure_ship, '')), ''), '없음')));
    end if;
    if new.arrival_ship is distinct from old.arrival_ship then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id,
        format('%s %s 도착 선박 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.arrival_ship_tag, '') || ' ' || coalesce(new.arrival_ship, '')), ''), '없음')));
    end if;
    if new.start_time is distinct from old.start_time or new.start_place is distinct from old.start_place then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id,
        format('%s %s 출근 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.start_time, '') || ' ' || coalesce(new.start_place, '')), ''), '기본(07:00 부두)')));
    end if;
    if new.unload_note is distinct from old.unload_note and coalesce(new.unload_note, '') <> '' then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 비고: %s', d, veh, un, new.unload_note));
    end if;
    if new.load_note is distinct from old.load_note and coalesce(new.load_note, '') <> '' then
      perform add_driver_notice(r.date, r.vehicle_id, coalesce(new.load_driver_id, new.driver_id), format('%s %s %s 비고: %s', d, veh, ld, new.load_note));
    end if;
    return null;
  end if;

  -- daily_orders
  kind_label := case when r.night then '야간 ' else '' end || case when r.kind = 'load' then '상차' else '하차' end;
  what := concat_ws(' ',
    nullif(coalesce((select name from clients c where c.id = r.client_id), r.client_text, ''), ''),
    nullif(coalesce((select name from products p where p.id = r.product_id), r.product_text, ''), ''),
    to_char(r.quantity, 'FM999999990.##') || coalesce(r.unit, ''));
  drv := coalesce(r.driver_id, (select case when r.night then vd.night_driver_id when vd.zone is not null and r.zone <> vd.zone then case when r.kind = 'load' then vd.turn_load_driver_id else vd.turn_driver_id end when r.kind = 'load' then coalesce(vd.load_driver_id, vd.driver_id) else vd.driver_id end
                                 from vehicle_days vd where vd.date = r.date and vd.vehicle_id = r.vehicle_id));
  if tg_op = 'INSERT' then
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 추가: %s', d, veh, kind_label, what));
  elsif tg_op = 'DELETE' then
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 취소: %s', d, veh, kind_label, what));
  else
    -- 다른 차량·날짜로 옮겨짐: 이전 기사에게는 빠짐
    if new.vehicle_id is distinct from old.vehicle_id or new.date is distinct from old.date then
      old_drv := coalesce(old.driver_id, (select case when old.night then vd.night_driver_id when vd.zone is not null and old.zone <> vd.zone then case when old.kind = 'load' then vd.turn_load_driver_id else vd.turn_driver_id end when old.kind = 'load' then coalesce(vd.load_driver_id, vd.driver_id) else vd.driver_id end
                                         from vehicle_days vd where vd.date = old.date and vd.vehicle_id = old.vehicle_id));
      if old_drv is distinct from drv or new.date is distinct from old.date then
        perform add_driver_notice(old.date, old.vehicle_id, old_drv,
          case when new.delayed_from = old.date
            then format('%s %s %s 연기 → %s: %s', to_char(old.date, 'FMMM/FMDD'), coalesce((select short_no from vehicles where id = old.vehicle_id), ''), kind_label, d, what)
            else format('%s %s %s 빠짐: %s%s', to_char(old.date, 'FMMM/FMDD'), coalesce((select short_no from vehicles where id = old.vehicle_id), ''), kind_label, what,
                        case when new.date is distinct from old.date then format(' (→ %s)', d) else '' end) end);
        perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 추가: %s', d, veh, kind_label, what));
        return null;
      end if;
    end if;
    if new.quantity is distinct from old.quantity or new.unit is distinct from old.unit then
      changes := changes || format('수량 %s→%s', coalesce(to_char(old.quantity, 'FM999999990.##'), '-'), coalesce(to_char(new.quantity, 'FM999999990.##') || coalesce(new.unit, ''), '-'));
    end if;
    if new.product_id is distinct from old.product_id or new.product_text is distinct from old.product_text then changes := changes || '품목'::text; end if;
    if new.client_id is distinct from old.client_id or new.client_text is distinct from old.client_text then changes := changes || '거래처'::text; end if;
    if new.work_time is distinct from old.work_time then changes := changes || format('시간 %s', coalesce(nullif(new.work_time, ''), '없음')); end if;
    if new.work_detail is distinct from old.work_detail then changes := changes || format('작업 %s', coalesce(nullif(new.work_detail, ''), '없음')); end if;
    if new.memo is distinct from old.memo then changes := changes || format('비고 %s', coalesce(nullif(new.memo, ''), '없음')); end if;
    if new.pickup_place is distinct from old.pickup_place then changes := changes || format('상차지 %s', coalesce(nullif(new.pickup_place, ''), '없음')); end if;
    if new.dropoff_place is distinct from old.dropoff_place then changes := changes || format('하차지 %s', coalesce(nullif(new.dropoff_place, ''), '없음')); end if;
    if new.departure_ship is distinct from old.departure_ship then changes := changes || format('선박 %s', coalesce(new.departure_ship, '없음')); end if;
    if new.night is distinct from old.night then changes := changes || case when new.night then '야간으로'::text else '야간 해제'::text end; end if;
    if new.unload_date is distinct from old.unload_date then changes := changes || format('지정 하차일 %s', coalesce(to_char(new.unload_date, 'FMMM/FMDD'), '없음')); end if;
    if array_length(changes, 1) is null then return null; end if; -- 기사와 상관없는 변경(금액 등)
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s %s 변경 (%s)', d, veh, kind_label, what, array_to_string(changes, ', ')));
  end if;
  return null;
end $$;

drop trigger if exists driver_notice on vehicle_days;
create trigger driver_notice after insert or update on vehicle_days for each row execute function notify_driver_change();
drop trigger if exists driver_notice on daily_orders;
create trigger driver_notice after insert or update or delete on daily_orders for each row execute function notify_driver_change();

-- ===== 20261029000031_ship_depart_port.sql =====
-- 선박 출발: 제주 쪽 출발 항구(비우면 제주) · 출발 시간이 다음 날(익일)인지. 육지 항구별 익일은 port_times 안 next_day
alter table ships add column if not exists depart_port text not null default '';
alter table ships add column if not exists depart_next_day boolean not null default false;

-- ===== 20261030000032_ship_wait.sql =====
-- 선박 운송 방식 "대기": 아직 배를 안 탐(선박 미정) · 차량·짐 그 지역에 그대로
alter table ships add column if not exists wait boolean not null default false;

-- ===== 20261031000033_dispatcher_week_lock.sql =====
-- 배차 담당자는 일주일(7일) 지난 일정을 고칠 수 없다 — 관리자만 수정 가능.
-- 날짜 기준은 한국 시간 오늘. 고치기 전·후 날짜 중 하나라도 (오늘-7일) 이전이면 막는다.
create or replace function block_old_edits() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cutoff date := (now() at time zone 'Asia/Seoul')::date - 7;
begin
  if app_role() = 'dispatcher' then
    if (tg_op in ('UPDATE','DELETE') and (old.date)::date < cutoff)
       or (tg_op in ('INSERT','UPDATE') and (new.date)::date < cutoff) then
      raise exception '7일 지난 일정은 관리자만 수정할 수 있습니다' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['daily_orders','vehicle_days','field_assignments','driver_work_logs','driver_day_pay'] loop
    execute format('drop trigger if exists block_old_edits on %I', t);
    execute format('create trigger block_old_edits before insert or update or delete on %I for each row execute function block_old_edits()', t);
  end loop;
end $$;

-- ===== 20261101000034_login_id.sql =====
-- 아이디 로그인 · 관리자가 계정 만들기
-- Supabase 로그인은 이메일이 꼭 필요해서, 아이디 hong → 내부 이메일 hong@gm.local 로 저장한다 (사용자는 아이디만 입력).
-- 기존 이메일 계정에 아이디를 붙이면 그 계정의 로그인 이메일도 아이디@gm.local 로 바뀐다 (원래 이메일은 profiles.email 에 남김).

alter table profiles add column if not exists login_id text;
alter table profiles add column if not exists email text not null default '';
create unique index if not exists profiles_login_id_key on profiles (login_id) where login_id is not null;

create or replace function login_email(p_login text) returns text
language sql immutable as $$ select lower(trim(p_login)) || '@gm.local' $$;

create or replace function check_login_id(p_login text) returns text
language plpgsql immutable as $$
declare l text := lower(trim(coalesce(p_login, '')));
begin
  if l !~ '^[a-z0-9][a-z0-9._-]{1,29}$' then
    raise exception '아이디는 영문 소문자·숫자로 2~30자 (중간에 . _ - 가능)';
  end if;
  return l;
end $$;

-- 관리자: 새 계정 만들기 (가입 메일 없이 바로 로그인 가능)
create or replace function admin_create_user(p_login text, p_name text, p_password text, p_role text default 'dispatcher')
returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  l text;
  uid uuid := gen_random_uuid();
  em text;
begin
  if app_role() <> 'admin' then raise exception '관리자만 만들 수 있습니다'; end if;
  l := check_login_id(p_login);
  em := login_email(l);
  if length(coalesce(p_password, '')) < 6 then raise exception '비밀번호는 6자 이상이어야 합니다'; end if;
  if p_role not in ('admin', 'dispatcher', 'viewer') then raise exception '권한 값이 잘못되었습니다'; end if;
  if exists (select 1 from profiles where login_id = l) or exists (select 1 from auth.users where lower(email) = em) then
    raise exception '이미 있는 아이디입니다: %', l;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('name', coalesce(nullif(trim(p_name), ''), l)), now(), now(),
    '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
          jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true),
          'email', now(), now(), now());

  -- 프로필은 가입 트리거(handle_new_user)가 만든다 → 이름·권한·아이디를 채운다
  insert into profiles (id, name, role) values (uid, coalesce(nullif(trim(p_name), ''), l), p_role)
  on conflict (id) do nothing;
  update profiles set name = coalesce(nullif(trim(p_name), ''), l), role = p_role, login_id = l where id = uid;
  return uid;
end $$;

-- 관리자: 기존 계정에 아이디 붙이기 / 아이디 바꾸기
create or replace function admin_set_login_id(target uuid, p_login text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  l text;
  em text;
  old_email text;
begin
  if app_role() <> 'admin' then raise exception '관리자만 바꿀 수 있습니다'; end if;
  l := check_login_id(p_login);
  em := login_email(l);
  if exists (select 1 from profiles where login_id = l and id <> target)
     or exists (select 1 from auth.users where lower(email) = em and id <> target) then
    raise exception '이미 있는 아이디입니다: %', l;
  end if;
  select email into old_email from auth.users where id = target;
  if not found then raise exception '사용자를 찾을 수 없습니다'; end if;
  update auth.users set email = em, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = target;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', em), updated_at = now()
   where user_id = target and provider = 'email';
  update profiles set login_id = l,
         email = case when old_email is not null and old_email not like '%@gm.local' then old_email else email end
   where id = target;
end $$;

revoke execute on function admin_create_user(text, text, text, text) from public, anon;
revoke execute on function admin_set_login_id(uuid, text) from public, anon;
grant execute on function admin_create_user(text, text, text, text) to authenticated;
grant execute on function admin_set_login_id(uuid, text) to authenticated;
