-- 2026-10-25 업데이트: 회원 관리 · 수리 구분 · 매일 새벽 2시 자동 백업 · 오후도착 (한 번에 붙여넣고 Run, 두 번 실행해도 괜찮음)

-- ===== 20261025000018_account_admin =====
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

-- ===== 20261025000019_quick_repair =====
-- 수리 시간 구분: quick = 경미(1시간 내, 운행 계속) / am = 오전 반나절 / pm = 오후 반나절 / full = 하루 이상(기간 동안 수리)
alter table maintenance_records add column if not exists repair_span text not null default 'full'
  check (repair_span in ('quick', 'am', 'pm', 'full'));

-- ===== 20261025000020_daily_server_backup =====
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

-- ===== 20261025000021_am_label =====
-- 오전(하차) 기사 칸에 이름 대신 적는 말: "오후도착" (배가 오후에 들어와 오전 일이 없음)
alter table vehicle_days add column if not exists am_label text not null default '';
