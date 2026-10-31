-- 2026-11-01 업데이트: 아이디 로그인 · 관리자가 계정 만들기 (한 번에 붙여넣고 Run, 두 번 실행해도 괜찮음)

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
