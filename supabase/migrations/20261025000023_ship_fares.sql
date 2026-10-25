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
