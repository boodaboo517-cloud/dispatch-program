-- 오후(상차) 기사를 오전(하차) 기사와 따로 지정 + 기사의 그날 처리 순서 (1번차·2번차…)
alter table vehicle_days add column if not exists load_driver_id uuid references drivers on delete set null;
alter table vehicle_days add column if not exists unload_seq smallint;
alter table vehicle_days add column if not exists load_seq smallint;

-- 오후만 맡은 기사도 그 차량 주행거리를 입력할 수 있게
drop policy if exists "driver odometer" on odometer_logs;
create policy "driver odometer" on odometer_logs for insert to authenticated with check (
  exists (select 1 from vehicles v where v.id = vehicle_id and v.default_driver_id = my_driver_id())
  or exists (select 1 from vehicle_days d where d.vehicle_id = odometer_logs.vehicle_id
             and (d.driver_id = my_driver_id() or d.load_driver_id = my_driver_id()))
);

-- 기사 알림: 출발(하행·오후) 선박 변경은 오후 기사에게, 상차 오더 변경도 오후 기사에게
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
    if tg_op <> 'UPDATE' then return null; end if;
    zone_label := case when new.zone = 'jeju' then '오후 선박' else '하행선박' end;
    if new.departure_ship is distinct from old.departure_ship then
      drv := coalesce(new.load_driver_id, new.driver_id);
      msg := format('%s %s로 변경', zone_label, coalesce(trim(new.departure_ship_tag || ' ' || new.departure_ship), '없음'));
    elsif new.arrival_ship is distinct from old.arrival_ship then
      drv := new.driver_id;
      msg := format('%s %s로 변경', case when new.zone = 'jeju' then '도착 선박' else '상행선박' end,
                    coalesce(trim(new.arrival_ship_tag || ' ' || new.arrival_ship), '없음'));
    else
      return null;
    end if;
    if drv is null then return null; end if;
  else
    drv := coalesce(r.driver_id, (select case when r.kind = 'load' then coalesce(d.load_driver_id, d.driver_id) else d.driver_id end
                                    from vehicle_days d where d.date = r.date and d.vehicle_id = r.vehicle_id));
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
