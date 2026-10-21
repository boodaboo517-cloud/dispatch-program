-- RLS 확인: 조회(기사) 계정은 읽기만, 금액 행은 아예 안 보임
-- 실행: psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql  (스키마·seed 적용된 DB, 테스트용)
begin;
insert into auth.users values ('11111111-1111-4111-8111-111111111111', 'admin@test', '{}');  -- 첫 가입자 = 관리자
insert into auth.users values ('22222222-2222-4222-8222-222222222222', 'driver@test', '{}');
update profiles set driver_id = '00000000-0000-4000-8000-000200000001' where id = '22222222-2222-4222-8222-222222222222';

-- 관리자: 오더·금액 입력
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
insert into daily_orders (id, date, zone, kind, client_id, vehicle_id, driver_id)
  values ('33333333-3333-4333-8333-333333333333', (now() at time zone 'Asia/Seoul')::date + 1, 'land', 'load',
          '00000000-0000-4000-8000-000400000004', '00000000-0000-4000-8000-000300000001', '00000000-0000-4000-8000-000200000001');
insert into order_revenue (order_id, unit_price, quantity, supply_amount, vat, total)
  values ('33333333-3333-4333-8333-333333333333', 90000, 10, 900000, 90000, 990000);
do $$ begin
  assert (select count(*) from order_revenue where order_id = '33333333-3333-4333-8333-333333333333') = 1, 'admin sees revenue';
  assert (select updated_by from daily_orders where id = '33333333-3333-4333-8333-333333333333') = '11111111-1111-4111-8111-111111111111', 'updated_by recorded';
end $$;
update daily_orders set departure_ship = '제이엘' where id = '33333333-3333-4333-8333-333333333333';
-- 기본 기사 대신 일정표에서 배차된 차량 (그 차량 주행거리는 기사가 입력 가능)
delete from vehicle_days where date = (now() at time zone 'Asia/Seoul')::date and vehicle_id = '00000000-0000-4000-8000-000300000001';
insert into vehicle_days (date, vehicle_id, zone, driver_id)
  values ((now() at time zone 'Asia/Seoul')::date, '00000000-0000-4000-8000-000300000001', 'land', '00000000-0000-4000-8000-000200000001');

-- 기사(조회): 읽기 O, 금액 X, 쓰기 X
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$ begin
  assert (select count(*) from daily_orders where id = '33333333-3333-4333-8333-333333333333') = 1, 'driver reads orders';
  assert (select count(*) from order_revenue) = 0, 'driver must not see revenue';
  assert (select count(*) from product_pricing) = 0, 'driver must not see pricing';
  assert (select count(*) from notices where message like '상차 선박 제이엘%') = 1, 'driver notified of ship change';
end $$;
do $$ begin
  update daily_orders set memo = 'hack';
  assert (select count(*) from daily_orders where memo = 'hack') = 0, 'driver update silently filtered';
end $$;
do $$ begin
  begin
    insert into daily_orders (date, zone, kind) values (current_date, 'land', 'load');
    raise exception 'driver insert should fail';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into order_revenue (order_id) values ('33333333-3333-4333-8333-333333333333');
    raise exception 'driver revenue insert should fail';
  exception when insufficient_privilege then null;
  end;
end $$;
-- 배차된 차량 주행거리는 입력 가능, 다른 차량은 불가
do $$ begin
  begin
    insert into odometer_logs (vehicle_id, date, km) values ('00000000-0000-4000-8000-000300000004', current_date, 1);
    raise exception 'driver odometer for unassigned vehicle should fail';
  exception when insufficient_privilege then null;
  end;
end $$;
insert into odometer_logs (vehicle_id, date, km) values ('00000000-0000-4000-8000-000300000001', current_date, 120000);

reset role;
do $$ begin
  assert (select count(*) from audit_log where table_name = 'daily_orders') >= 2, 'audit log written';
end $$;
select 'RLS OK' as result;
rollback;
