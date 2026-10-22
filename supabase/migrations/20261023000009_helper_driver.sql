-- 한 차량에 기사 2명: 동승 기사 (선탑·교육 / 지원)
alter table vehicle_days add column if not exists helper_driver_id uuid references drivers on delete set null;
alter table vehicle_days add column if not exists helper_role text not null default '' check (helper_role in ('', '선탑', '지원'));
