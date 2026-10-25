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
