-- 접속 기록: 아이디별 로그인 · 앱 열기 · 로그아웃 · 창 닫기 시각 (관리자만 조회, 24시간 보관)
-- "지금 접속 중" 목록은 DB 가 아니라 Realtime Presence 로 (창을 닫거나 1분 넘게 응답이 없으면 빠짐)

create table if not exists access_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid not null,
  login_id text not null default '',
  event text not null check (event in ('로그인', '접속', '로그아웃', '종료')),
  device text not null default ''
);
create index if not exists access_log_at_idx on access_log (at desc);

alter table access_log enable row level security;
drop policy if exists "admin read" on access_log;
create policy "admin read" on access_log for select to authenticated using (app_role() = 'admin');
revoke insert, update, delete, truncate on access_log from authenticated, anon;
grant select on access_log to authenticated;

-- 본인 기록만 남길 수 있다 (아이디·시각은 서버가 채움)
create or replace function log_access(p_event text, p_device text default '') returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  if p_event not in ('로그인', '접속', '로그아웃', '종료') then raise exception '잘못된 기록'; end if;
  insert into access_log (user_id, login_id, event, device)
  values (uid, coalesce((select coalesce(nullif(login_id, ''), name) from profiles where id = uid), ''), p_event, left(coalesce(p_device, ''), 20));
end $$;
revoke execute on function log_access(text, text) from public, anon;
grant execute on function log_access(text, text) to authenticated;

-- 정리에 접속 기록(24시간)도 포함
create or replace function purge_change_log() returns void
language sql security definer set search_path = public as $$
  delete from change_log where at < now() - interval '24 hours';
  delete from access_log where at < now() - interval '24 hours';
  delete from audit_log where at < now() - interval '30 days';
$$;
revoke execute on function purge_change_log() from public, anon;
grant execute on function purge_change_log() to authenticated;
