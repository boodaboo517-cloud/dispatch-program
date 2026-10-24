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
