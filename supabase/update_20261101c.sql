-- 2026-11-01 업데이트 ③: 수정 이력 (칸별 기록 · 24시간 보관 · 조회 전용) (한 번에 붙여넣고 Run, 두 번 실행해도 괜찮음)

-- 수정 이력 (칸별): 누가 · 언제 · 어느 화면의 무엇을 · 무엇에서 무엇으로.
-- 서버 트리거가 자동으로 기록하므로 앱에서 빠지거나 고칠 수 없다. 24시간 지난 기록은 자동 삭제 (조회 전용).
-- 기존 audit_log(줄 전체 기록, 복구용)는 30일만 남긴다.

create table if not exists change_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,
  login_id text not null default '',
  op text not null,              -- 등록 / 수정 / 삭제
  screen text not null,          -- 오더 / 차량 일정 / 현장근무 / 거래처 / 품목 / 차량 / 기사
  table_name text not null,
  row_id uuid,
  target text not null default '', -- 예: 11/1 육지 하차 · 9915 · 대동물류 냉동식품
  field text not null default '',  -- 칸 이름 (컬럼)
  field_label text not null default '',
  before text not null default '',
  after text not null default '',
  cell_date date                 -- 일정표 칸 날짜 (오더·차량 일정·현장근무)
);
create index if not exists change_log_at_idx on change_log (at desc);
create index if not exists change_log_row_idx on change_log (table_name, row_id, at desc);

alter table change_log enable row level security;
drop policy if exists "staff read" on change_log;
create policy "staff read" on change_log for select to authenticated using (is_staff());
-- 쓰기·고치기·지우기 정책 없음 = 누구도 API 로 바꿀 수 없음 (기록은 아래 트리거만)
revoke insert, update, delete, truncate on change_log from authenticated, anon;
grant select on change_log to authenticated;

-- 기록할 칸과 화면에 보일 이름 (여기 없는 칸은 기록하지 않음: 수정시각·내부 연결값 등)
create table if not exists change_field_labels (
  table_name text not null,
  column_name text not null,
  label text not null,
  primary key (table_name, column_name)
);
alter table change_field_labels enable row level security;
drop policy if exists "read" on change_field_labels;
create policy "read" on change_field_labels for select to authenticated using (true);
grant select on change_field_labels to authenticated;

insert into change_field_labels (table_name, column_name, label) values
  ('daily_orders','date','날짜'), ('daily_orders','zone','지역'), ('daily_orders','kind','상·하차'),
  ('daily_orders','client_id','거래처'), ('daily_orders','client_text','거래처(직접 입력)'),
  ('daily_orders','product_id','품목'), ('daily_orders','product_text','품목(직접 입력)'),
  ('daily_orders','region','지역명'), ('daily_orders','quantity','수량'), ('daily_orders','unit','단위'),
  ('daily_orders','memo','비고'), ('daily_orders','vehicle_id','차량'), ('daily_orders','driver_id','기사'),
  ('daily_orders','arrival_ship','도착 선박'), ('daily_orders','arrival_ship_tag','도착 선박 표시'),
  ('daily_orders','departure_ship','출발 선박'), ('daily_orders','departure_ship_tag','출발 선박 표시'),
  ('daily_orders','pickup_place','상차지'), ('daily_orders','dropoff_place','하차지'),
  ('daily_orders','same_day','당일 왕복'), ('daily_orders','carrier_type','운송(자차·용차)'),
  ('daily_orders','carrier_name','용차 업체'), ('daily_orders','carrier_vehicle','용차 차량'), ('daily_orders','carrier_phone','용차 연락처'),
  ('daily_orders','shipment','운송 방식'), ('daily_orders','work_time','작업 시간'), ('daily_orders','work_detail','작업 내용'),
  ('daily_orders','ship_date','선적일'), ('daily_orders','unload_hold','하차 보류'), ('daily_orders','night','야간'),

  ('vehicle_days','zone','위치'), ('vehicle_days','driver_id','기사(하차·오전)'), ('vehicle_days','load_driver_id','기사(상차·오후)'),
  ('vehicle_days','arrival_ship','도착 선박'), ('vehicle_days','arrival_ship_tag','도착 선박 표시'),
  ('vehicle_days','departure_ship','출발 선박'), ('vehicle_days','departure_ship_tag','출발 선박 표시'),
  ('vehicle_days','status','상태'), ('vehicle_days','status_memo','상태 메모'),
  ('vehicle_days','helper_driver_id','동승'), ('vehicle_days','helper_role','동승 역할'),
  ('vehicle_days','start_time','출근 시간'), ('vehicle_days','start_place','출근 장소'),
  ('vehicle_days','unload_note','하차 메모'), ('vehicle_days','load_note','상차 메모'), ('vehicle_days','am_label','오후도착'),
  ('vehicle_days','unload_seq','하차 순서'), ('vehicle_days','load_seq','상차 순서'),
  ('vehicle_days','night_driver_id','야간 기사'), ('vehicle_days','turn','연속운행'),
  ('vehicle_days','turn_driver_id','연속운행 기사(하차)'), ('vehicle_days','turn_load_driver_id','연속운행 기사(상차)'),
  ('vehicle_days','turn_departure_ship','연속운행 출발 선박'), ('vehicle_days','fare_kind','선박 요금'), ('vehicle_days','boarding','승선'),

  ('field_assignments','date','날짜'), ('field_assignments','site_id','근무지'), ('field_assignments','staff_id','근무자'),
  ('field_assignments','task','업무'), ('field_assignments','vehicle_id','지급 차량'), ('field_assignments','is_off','휴무'),
  ('field_assignments','part','오전·오후'),

  ('clients','name','거래처명'), ('clients','manager','담당자'), ('clients','phone','연락처'), ('clients','default_ship','기본 선박'),
  ('clients','memo','비고'), ('clients','pickup_address','상차지 주소'), ('clients','dropoff_address','하차지 주소'),
  ('clients','pickup_contact_name','상차지 담당'), ('clients','pickup_contact_phone','상차지 연락처'),
  ('clients','dropoff_contact_name','하차지 담당'), ('clients','dropoff_contact_phone','하차지 연락처'),

  ('products','client_id','거래처'), ('products','name','품목명'), ('products','default_region','기본 지역'),
  ('products','default_quantity','기본 수량'), ('products','default_unit','기본 단위'),
  ('products','pickup_address','상차지 주소'), ('products','pickup_note','상차 메모'),
  ('products','dropoff_address','하차지 주소'), ('products','dropoff_note','하차 메모'),
  ('products','pickup_contact_name','상차지 담당'), ('products','pickup_contact_phone','상차지 연락처'),
  ('products','dropoff_contact_name','하차지 담당'), ('products','dropoff_contact_phone','하차지 연락처'),
  ('products','storage','보관(상온·냉장·냉동)'), ('products','temp_min','최저 온도'), ('products','temp_max','최고 온도'),
  ('products','caution','주의사항'),

  ('vehicles','plate','차량번호'), ('vehicles','short_no','표시 4자리'), ('vehicles','vehicle_type','차종'),
  ('vehicles','usage','구분'), ('vehicles','ownership','소속'), ('vehicles','default_driver_id','기본 기사'),
  ('vehicles','status','상태'), ('vehicles','home_zone','현재 위치'), ('vehicles','oil_interval_km','오일 교환 주기'),

  ('drivers','name','이름'), ('drivers','phone','연락처'), ('drivers','work_days','근무 요일'), ('drivers','shift','근무조'),
  ('drivers','affiliation','소속'), ('drivers','staff_type','구분'), ('drivers','memo','비고'), ('drivers','team','팀'),
  ('drivers','zone','지역'), ('drivers','unlisted','목록에서 숨김')
on conflict (table_name, column_name) do update set label = excluded.label;

-- 값 → 사람이 읽는 글자 (차량·기사·거래처 번호는 이름으로)
create or replace function change_value(p_col text, v jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  t text;
begin
  if v is null or v = 'null'::jsonb then return ''; end if;
  t := case when jsonb_typeof(v) = 'string' then v #>> '{}' else v::text end;
  if t = '' then return ''; end if;
  if p_col in ('driver_id','load_driver_id','helper_driver_id','night_driver_id','turn_driver_id','turn_load_driver_id','staff_id','default_driver_id') then
    return coalesce((select name from drivers where id = t::uuid), '(삭제된 기사)');
  elsif p_col = 'vehicle_id' then
    return coalesce((select short_no from vehicles where id = t::uuid), '(삭제된 차량)');
  elsif p_col = 'client_id' then
    return coalesce((select name from clients where id = t::uuid), '(삭제된 거래처)');
  elsif p_col = 'product_id' then
    return coalesce((select name from products where id = t::uuid), '(삭제된 품목)');
  elsif p_col = 'site_id' then
    return coalesce((select name from field_sites where id = t::uuid), '(삭제된 근무지)');
  elsif p_col in ('zone','home_zone') then
    return case t when 'land' then '육지' when 'jeju' then '제주' else t end;
  elsif p_col = 'kind' then
    return case t when 'load' then '상차' when 'unload' then '하차' else t end;
  elsif jsonb_typeof(v) = 'boolean' then
    return case when v = 'true'::jsonb then '예' else '아니오' end;
  elsif p_col = 'work_days' and jsonb_typeof(v) = 'array' then
    return coalesce((select string_agg(substr('일월화수목금토', (x #>> '{}')::int + 1, 1), '' order by (x #>> '{}')::int) from jsonb_array_elements(v) x), '');
  elsif jsonb_typeof(v) = 'array' then
    return coalesce((select string_agg(x #>> '{}', ',') from jsonb_array_elements(v) x), '');
  end if;
  return t;
end $$;

-- 대상 식별값: 오더 "11/1 육지 하차 · 9915 · 대동물류 냉동식품", 차량 일정 "11/1 9915 (육지)" …
create or replace function change_target(p_table text, r jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  d text := case when r ? 'date' and r->>'date' is not null
                 then to_char((r->>'date')::date, 'FMMM/FMDD') else '' end;
begin
  if p_table = 'daily_orders' then
    return concat_ws(' · ',
      concat_ws(' ', d, change_value('zone', r->'zone'), change_value('kind', r->'kind')),
      coalesce(nullif(change_value('vehicle_id', r->'vehicle_id'), ''), '미배차'),
      nullif(trim(concat_ws(' ', coalesce(nullif(change_value('client_id', r->'client_id'), ''), r->>'client_text'),
                                  coalesce(nullif(change_value('product_id', r->'product_id'), ''), r->>'product_text'))), ''));
  elsif p_table = 'vehicle_days' then
    return concat_ws(' ', d, change_value('vehicle_id', r->'vehicle_id'),
                     case when coalesce(r->>'zone', '') <> '' then '(' || change_value('zone', r->'zone') || ')' end);
  elsif p_table = 'field_assignments' then
    return concat_ws(' ', d, '현장', change_value('staff_id', r->'staff_id'));
  elsif p_table = 'clients' then
    return r->>'name';
  elsif p_table = 'products' then
    return concat_ws(' ', change_value('client_id', r->'client_id'), r->>'name');
  elsif p_table = 'vehicles' then
    return concat_ws(' ', r->>'short_no', nullif('(' || coalesce(r->>'plate', '') || ')', '()'));
  elsif p_table = 'drivers' then
    return r->>'name';
  end if;
  return '';
end $$;

create or replace function log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  uid uuid := auth.uid();
  who text;
  scr text := case tg_table_name
    when 'daily_orders' then '오더' when 'vehicle_days' then '차량 일정' when 'field_assignments' then '현장근무'
    when 'clients' then '거래처' when 'products' then '품목' when 'vehicles' then '차량' when 'drivers' then '기사'
    else tg_table_name end;
  tgt text;
  cd date := case when r ? 'date' and r->>'date' is not null then (r->>'date')::date end;
  f record;
  b text;
  a text;
begin
  who := coalesce((select coalesce(nullif(login_id, ''), nullif(name, '')) from profiles where id = uid), case when uid is null then '시스템' else '' end);
  tgt := coalesce(change_target(tg_table_name, r), '');
  if tg_op = 'INSERT' then
    insert into change_log (actor, login_id, op, screen, table_name, row_id, target, cell_date)
    values (uid, who, '등록', scr, tg_table_name, (r->>'id')::uuid, tgt, cd);
  elsif tg_op = 'DELETE' then
    insert into change_log (actor, login_id, op, screen, table_name, row_id, target, cell_date)
    values (uid, who, '삭제', scr, tg_table_name, (r->>'id')::uuid, tgt, cd);
  else
    for f in select column_name, label from change_field_labels where table_name = tg_table_name loop
      if (o -> f.column_name) is not distinct from (n -> f.column_name) then continue; end if;
      b := coalesce(change_value(f.column_name, o -> f.column_name), '');
      a := coalesce(change_value(f.column_name, n -> f.column_name), '');
      if b = a then continue; end if; -- 빈 값 '' ↔ null 등은 같은 것으로
      insert into change_log (actor, login_id, op, screen, table_name, row_id, target, field, field_label, before, after, cell_date)
      values (uid, who, '수정', scr, tg_table_name, (r->>'id')::uuid, tgt, f.column_name, f.label, b, a, cd);
    end loop;
  end if;
  -- 예약 작업이 멈춰도 쌓이지 않게: 가끔 한 번씩 정리
  if random() < 0.01 then delete from change_log where at < now() - interval '24 hours'; end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['daily_orders','vehicle_days','field_assignments','clients','products','vehicles','drivers'] loop
    execute format('drop trigger if exists change_log on %I', t);
    execute format('create trigger change_log after insert or update or delete on %I for each row execute function log_change()', t);
  end loop;
end $$;

-- 정리: 수정 이력 24시간, 예전 줄 전체 기록(audit_log) 30일
create or replace function purge_change_log() returns void
language sql security definer set search_path = public as $$
  delete from change_log where at < now() - interval '24 hours';
  delete from audit_log where at < now() - interval '30 days';
$$;
revoke execute on function purge_change_log() from public, anon;
grant execute on function purge_change_log() to authenticated;

-- 실시간: 다른 사람이 고친 칸 표시를 바로
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'change_log') then
    execute 'alter publication supabase_realtime add table change_log';
  end if;
end $$;

-- 매시간 정리 (pg_cron 이 있을 때)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-change-log';
    perform cron.schedule('purge-change-log', '7 * * * *', 'select purge_change_log()');
  end if;
end $$;

select purge_change_log();
