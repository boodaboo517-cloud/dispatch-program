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
