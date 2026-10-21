-- 용차·화주배차, 벌크 선적, 하차 날짜 조정. 선박 표시(ship_tag)는 예약 업체 이름도 쓰므로 자유 글자.
alter table daily_orders
  add column if not exists carrier_type text not null default 'own' check (carrier_type in ('own','hired','shipper')),
  add column if not exists carrier_name text not null default '',
  add column if not exists carrier_vehicle text not null default '',
  add column if not exists carrier_phone text not null default '',
  add column if not exists shipment text not null default 'vehicle' check (shipment in ('vehicle','bulk')),
  add column if not exists arrival_offset smallint check (arrival_offset is null or arrival_offset between 0 and 7);

-- 기사는 매일 바뀌므로 차량 기본 기사는 더 이상 쓰지 않는다 (기존 값은 비움)
update vehicles set default_driver_id = null where default_driver_id is not null;
