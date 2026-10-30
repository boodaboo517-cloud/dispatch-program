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
