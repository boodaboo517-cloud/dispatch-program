-- 2026-10-25 추가 업데이트 ⑤: 하차 연기 · 지정일 하차 · 기사 알림 자세히 (한 번에 붙여넣고 Run, 두 번 실행해도 괜찮음)

-- 하차 연기 · 고객 지정일 하차(차량 대기 / 창고 보관) · 기사 알림 내용 자세히

alter table daily_orders add column if not exists delayed_from date;
alter table daily_orders add column if not exists unload_date date;
alter table daily_orders add column if not exists unload_hold text not null default '' check (unload_hold in ('', 'vehicle', 'storage'));

-- 기사 알림 한 줄 (기사가 없으면 안 남김)
create or replace function add_driver_notice(p_date date, p_vehicle uuid, p_driver uuid, p_msg text) returns void
language sql security definer set search_path = public as $$
  insert into notices (date, vehicle_id, driver_id, message)
  select p_date, p_vehicle, p_driver, p_msg where p_driver is not null and coalesce(p_msg, '') <> ''
$$;

-- 기사 본인 일정이 바뀌면 알림: "10/26 9915 하차 도민물류 감귤 10p 변경 (수량 10→8)"
create or replace function notify_driver_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  veh text;
  d text;
  un text;
  ld text;
  what text;
  changes text[] := '{}';
  drv uuid;
  old_drv uuid;
  kind_label text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.date < (now() at time zone 'Asia/Seoul')::date then return null; end if;
  veh := coalesce((select short_no from vehicles where id = r.vehicle_id), '');
  d := to_char(r.date, 'FMMM/FMDD');

  if tg_table_name = 'vehicle_days' then
    un := case when r.zone = 'jeju' then '오전' else '하차' end;
    ld := case when r.zone = 'jeju' then '오후' else '상차' end;
    -- 배차됨 / 빠짐
    if tg_op = 'INSERT' then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 배차됨', d, veh, case when new.load_driver_id is null or new.load_driver_id = new.driver_id then un || '·' || ld else un end));
      if new.load_driver_id is distinct from new.driver_id then
        perform add_driver_notice(r.date, r.vehicle_id, new.load_driver_id, format('%s %s %s 배차됨', d, veh, ld));
      end if;
      return null;
    end if;
    if tg_op <> 'UPDATE' then return null; end if;
    if new.driver_id is distinct from old.driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.driver_id, format('%s %s %s 배차 빠짐', d, veh, un));
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 배차됨', d, veh, un));
    end if;
    if new.load_driver_id is distinct from old.load_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.load_driver_id, format('%s %s %s 배차 빠짐', d, veh, ld));
      perform add_driver_notice(r.date, r.vehicle_id, new.load_driver_id, format('%s %s %s 배차됨', d, veh, ld));
    end if;
    if new.helper_driver_id is distinct from old.helper_driver_id then
      perform add_driver_notice(r.date, r.vehicle_id, old.helper_driver_id, format('%s %s 동승 빠짐', d, veh));
      perform add_driver_notice(r.date, r.vehicle_id, new.helper_driver_id, format('%s %s 동승(%s) 배정', d, veh, coalesce(nullif(new.helper_role, ''), '동승')));
    end if;
    if new.departure_ship is distinct from old.departure_ship then
      perform add_driver_notice(r.date, r.vehicle_id, coalesce(new.load_driver_id, new.driver_id),
        format('%s %s 출발 선박 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.departure_ship_tag, '') || ' ' || coalesce(new.departure_ship, '')), ''), '없음')));
    end if;
    if new.arrival_ship is distinct from old.arrival_ship then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id,
        format('%s %s 도착 선박 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.arrival_ship_tag, '') || ' ' || coalesce(new.arrival_ship, '')), ''), '없음')));
    end if;
    if new.start_time is distinct from old.start_time or new.start_place is distinct from old.start_place then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id,
        format('%s %s 출근 %s로 변경', d, veh, coalesce(nullif(trim(coalesce(new.start_time, '') || ' ' || coalesce(new.start_place, '')), ''), '기본(07:00 부두)')));
    end if;
    if new.unload_note is distinct from old.unload_note and coalesce(new.unload_note, '') <> '' then
      perform add_driver_notice(r.date, r.vehicle_id, new.driver_id, format('%s %s %s 비고: %s', d, veh, un, new.unload_note));
    end if;
    if new.load_note is distinct from old.load_note and coalesce(new.load_note, '') <> '' then
      perform add_driver_notice(r.date, r.vehicle_id, coalesce(new.load_driver_id, new.driver_id), format('%s %s %s 비고: %s', d, veh, ld, new.load_note));
    end if;
    return null;
  end if;

  -- daily_orders
  kind_label := case when r.kind = 'load' then '상차' else '하차' end;
  what := concat_ws(' ',
    nullif(coalesce((select name from clients c where c.id = r.client_id), r.client_text, ''), ''),
    nullif(coalesce((select name from products p where p.id = r.product_id), r.product_text, ''), ''),
    to_char(r.quantity, 'FM999999990.##') || coalesce(r.unit, ''));
  drv := coalesce(r.driver_id, (select case when r.kind = 'load' then coalesce(vd.load_driver_id, vd.driver_id) else vd.driver_id end
                                 from vehicle_days vd where vd.date = r.date and vd.vehicle_id = r.vehicle_id));
  if tg_op = 'INSERT' then
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 추가: %s', d, veh, kind_label, what));
  elsif tg_op = 'DELETE' then
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 취소: %s', d, veh, kind_label, what));
  else
    -- 다른 차량·날짜로 옮겨짐: 이전 기사에게는 빠짐
    if new.vehicle_id is distinct from old.vehicle_id or new.date is distinct from old.date then
      old_drv := coalesce(old.driver_id, (select case when old.kind = 'load' then coalesce(vd.load_driver_id, vd.driver_id) else vd.driver_id end
                                         from vehicle_days vd where vd.date = old.date and vd.vehicle_id = old.vehicle_id));
      if old_drv is distinct from drv or new.date is distinct from old.date then
        perform add_driver_notice(old.date, old.vehicle_id, old_drv,
          case when new.delayed_from = old.date
            then format('%s %s %s 연기 → %s: %s', to_char(old.date, 'FMMM/FMDD'), coalesce((select short_no from vehicles where id = old.vehicle_id), ''), kind_label, d, what)
            else format('%s %s %s 빠짐: %s%s', to_char(old.date, 'FMMM/FMDD'), coalesce((select short_no from vehicles where id = old.vehicle_id), ''), kind_label, what,
                        case when new.date is distinct from old.date then format(' (→ %s)', d) else '' end) end);
        perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s 추가: %s', d, veh, kind_label, what));
        return null;
      end if;
    end if;
    if new.quantity is distinct from old.quantity or new.unit is distinct from old.unit then
      changes := changes || format('수량 %s→%s', coalesce(to_char(old.quantity, 'FM999999990.##'), '-'), coalesce(to_char(new.quantity, 'FM999999990.##') || coalesce(new.unit, ''), '-'));
    end if;
    if new.product_id is distinct from old.product_id or new.product_text is distinct from old.product_text then changes := changes || '품목'::text; end if;
    if new.client_id is distinct from old.client_id or new.client_text is distinct from old.client_text then changes := changes || '거래처'::text; end if;
    if new.work_time is distinct from old.work_time then changes := changes || format('시간 %s', coalesce(nullif(new.work_time, ''), '없음')); end if;
    if new.work_detail is distinct from old.work_detail then changes := changes || format('작업 %s', coalesce(nullif(new.work_detail, ''), '없음')); end if;
    if new.memo is distinct from old.memo then changes := changes || format('비고 %s', coalesce(nullif(new.memo, ''), '없음')); end if;
    if new.pickup_place is distinct from old.pickup_place then changes := changes || format('상차지 %s', coalesce(nullif(new.pickup_place, ''), '없음')); end if;
    if new.dropoff_place is distinct from old.dropoff_place then changes := changes || format('하차지 %s', coalesce(nullif(new.dropoff_place, ''), '없음')); end if;
    if new.departure_ship is distinct from old.departure_ship then changes := changes || format('선박 %s', coalesce(new.departure_ship, '없음')); end if;
    if new.unload_date is distinct from old.unload_date then changes := changes || format('지정 하차일 %s', coalesce(to_char(new.unload_date, 'FMMM/FMDD'), '없음')); end if;
    if array_length(changes, 1) is null then return null; end if; -- 기사와 상관없는 변경(금액 등)
    perform add_driver_notice(r.date, r.vehicle_id, drv, format('%s %s %s %s 변경 (%s)', d, veh, kind_label, what, array_to_string(changes, ', ')));
  end if;
  return null;
end $$;

drop trigger if exists driver_notice on vehicle_days;
create trigger driver_notice after insert or update on vehicle_days for each row execute function notify_driver_change();
drop trigger if exists driver_notice on daily_orders;
create trigger driver_notice after insert or update or delete on daily_orders for each row execute function notify_driver_change();
