-- 2026-11-01 업데이트 ②: 동시 수정 감지 — 다른 사용자가 먼저 고쳤으면 저장을 거절하고 알림 (한 번에 붙여넣고 Run, 두 번 실행해도 괜찮음)

-- 동시 수정 감지: 화면이 "내가 본 시점의 수정시각(edit_base)"을 같이 보내면,
-- 그 뒤에 다른 사용자가 먼저 저장했을 때 저장을 거절하고 누가 바꿨는지 알려 준다 (오류 코드 GM409).
-- edit_base 는 확인용으로만 쓰고 저장하지 않는다 (항상 비워 둠). 앱이 자동으로 맞추는 연쇄 변경은 edit_base 없이 보내므로 검사하지 않는다.

create or replace function check_edit_conflict() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
begin
  if tg_op = 'UPDATE' and new.edit_base is not null
     and old.updated_at > new.edit_base + interval '1 millisecond'
     and old.updated_by is distinct from auth.uid() then
    select coalesce(nullif(login_id, ''), nullif(name, ''), '다른 사용자') into who from profiles where id = old.updated_by;
    raise exception '%', format('%s(이)가 먼저 수정했습니다', coalesce(who, '시스템'))
      using errcode = 'GM409',
            detail = json_build_object('by', coalesce(who, '시스템'), 'at', old.updated_at, 'table', tg_table_name, 'id', old.id)::text;
  end if;
  -- 새 줄(INSERT)에는 손대지 않는다: upsert 는 INSERT 트리거를 거친 값을 ON CONFLICT 수정에 쓰므로 여기서 지우면 검사가 안 된다
  if tg_op = 'UPDATE' then new.edit_base := null; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['daily_orders','vehicle_days','field_assignments','clients','products','vehicles','drivers','ships'] loop
    execute format('alter table %I add column if not exists edit_base timestamptz', t);
    -- touch(수정시각 기록)보다 먼저 돌도록 이름이 앞선다 (같은 BEFORE 트리거는 이름순)
    execute format('drop trigger if exists a_edit_conflict on %I', t);
    execute format('create trigger a_edit_conflict before update on %I for each row execute function check_edit_conflict()', t);
  end loop;
end $$;
