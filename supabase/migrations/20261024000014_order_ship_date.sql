-- 선박 "대기"로 상차한 짐을 실제로 배에 싣는 날 (비우면 상차일)
alter table daily_orders add column if not exists ship_date date;
