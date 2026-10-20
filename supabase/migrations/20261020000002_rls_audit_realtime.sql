-- 권한(RLS) · 변경 이력 · 실시간 · 기사 알림

-- ───────── updated_at / updated_by 자동 기록 ─────────
create or replace function touch_row() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- ───────── 변경 이력 (누가·언제·무엇을) ─────────
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (table_name, row_id, op, old_row, new_row, actor)
  values (tg_table_name,
          coalesce((case when tg_op = 'DELETE' then old.id else new.id end), null),
          tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
          auth.uid());
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'drivers','ships','clients','products','product_pricing','product_photos','product_suggestions',
    'vehicles','recurring_orders','recurring_order_versions','daily_orders','vehicle_days','order_revenue',
    'field_sites','recurring_field_work','recurring_field_versions','field_assignments',
    'maintenance_records','maintenance_schedules','odometer_logs','settings','notices'
  ] loop
    execute format('create trigger touch before insert or update on %I for each row execute function touch_row()', t);
    execute format('create trigger audit after insert or update or delete on %I for each row execute function audit_row()', t);
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I replica identity full', t);
    execute format('alter publication supabase_realtime add table %I', t);
  end loop;
end $$;

alter table profiles enable row level security;
alter table audit_log enable row level security;

-- ───────── 기본 정책: 로그인 사용자 읽기, 관리자·배차만 쓰기 ─────────
do $$
declare t text;
begin
  foreach t in array array[
    'drivers','ships','clients','products','product_photos','vehicles','recurring_orders',
    'recurring_order_versions','daily_orders','vehicle_days','field_sites','recurring_field_work',
    'recurring_field_versions','field_assignments','maintenance_records','maintenance_schedules','odometer_logs'
  ] loop
    execute format('create policy "read" on %I for select to authenticated using (true)', t);
    execute format('create policy "staff insert" on %I for insert to authenticated with check (is_staff())', t);
    execute format('create policy "staff update" on %I for update to authenticated using (is_staff()) with check (is_staff())', t);
    execute format('create policy "staff delete" on %I for delete to authenticated using (is_staff())', t);
  end loop;
end $$;

-- 금액 테이블: 관리자·배차만. 기사·조회 계정은 select 정책이 없으므로 행이 아예 내려가지 않는다.
create policy "staff all" on order_revenue for all to authenticated using (is_staff()) with check (is_staff());
create policy "staff all" on product_pricing for all to authenticated using (is_staff()) with check (is_staff());

-- 기사: 본인 차량 주행거리 입력 허용
create policy "driver odometer" on odometer_logs for insert to authenticated with check (
  exists (select 1 from vehicles v where v.id = vehicle_id and v.default_driver_id = my_driver_id())
  or exists (select 1 from vehicle_days d where d.vehicle_id = odometer_logs.vehicle_id and d.driver_id = my_driver_id())
);

-- 기사 제안(사진·주의사항) — 설정에서 허용했을 때만, 관리자 승인 후 반영
create policy "read own or staff" on product_suggestions for select to authenticated
  using (is_staff() or created_by = auth.uid());
create policy "driver suggest" on product_suggestions for insert to authenticated with check (
  is_staff() or (
    created_by = auth.uid() and status = 'pending'
    and coalesce((select (value)::text = 'true' from settings where key = 'driver_suggestions'), false)
  )
);
create policy "staff review" on product_suggestions for update to authenticated using (is_staff()) with check (is_staff());
create policy "staff delete" on product_suggestions for delete to authenticated using (is_staff());

create policy "read" on settings for select to authenticated using (true);
create policy "admin write" on settings for all to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');

create policy "read mine or staff" on notices for select to authenticated using (is_staff() or driver_id = my_driver_id());
create policy "staff write" on notices for all to authenticated using (is_staff()) with check (is_staff());

create policy "read self or staff" on profiles for select to authenticated using (id = auth.uid() or is_staff());
create policy "admin update" on profiles for update to authenticated using (app_role() = 'admin') with check (app_role() = 'admin');

create policy "staff read" on audit_log for select to authenticated using (is_staff());

alter publication supabase_realtime add table profiles;

-- ───────── 기사 알림: 본인 배차가 바뀌면 notices 에 기록 (앱 상단 노란 띠 + 알림) ─────────
create or replace function notify_driver_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  drv uuid;
  msg text;
  zone_label text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.date < (now() at time zone 'Asia/Seoul')::date then return null; end if;

  if tg_table_name = 'vehicle_days' then
    drv := r.driver_id;
    if drv is null or tg_op <> 'UPDATE' then return null; end if;
    zone_label := case when new.zone = 'jeju' then '오후 선박' else '하행선박' end;
    if new.departure_ship is distinct from old.departure_ship then
      msg := format('%s %s로 변경', zone_label, coalesce(trim(new.departure_ship_tag || ' ' || new.departure_ship), '없음'));
    elsif new.arrival_ship is distinct from old.arrival_ship then
      msg := format('%s %s로 변경', case when new.zone = 'jeju' then '도착 선박' else '상행선박' end,
                    coalesce(trim(new.arrival_ship_tag || ' ' || new.arrival_ship), '없음'));
    else
      return null;
    end if;
  else
    drv := coalesce(r.driver_id, (select driver_id from vehicle_days d where d.date = r.date and d.vehicle_id = r.vehicle_id));
    if drv is null then return null; end if;
    msg := format('%s %s %s',
      case when r.kind = 'load' then '상차' else '하차' end,
      coalesce((select name from clients c where c.id = r.client_id), r.client_text, ''),
      case tg_op when 'INSERT' then '추가' when 'DELETE' then '취소' else '변경' end);
    if tg_op = 'UPDATE' and new.departure_ship is distinct from old.departure_ship then
      msg := format('상차 선박 %s로 변경', coalesce(new.departure_ship, '없음'));
    end if;
  end if;

  insert into notices (date, vehicle_id, driver_id, message) values (r.date, r.vehicle_id, drv, msg);
  return null;
end $$;

create trigger driver_notice after update on vehicle_days for each row execute function notify_driver_change();
create trigger driver_notice after insert or update or delete on daily_orders for each row execute function notify_driver_change();

-- ───────── 사진 저장소 ─────────
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict do nothing;
create policy "photos read" on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy "photos staff write" on storage.objects for insert to authenticated with check (
  bucket_id = 'photos' and (is_staff() or (storage.foldername(name))[1] = 'suggestions')
);
create policy "photos staff delete" on storage.objects for delete to authenticated using (bucket_id = 'photos' and is_staff());
