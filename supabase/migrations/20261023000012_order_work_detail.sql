-- 상·하차 세부: 작업 시간과 내용 (예: 08:40 하차 · 막걸리공병 하차지원)
alter table daily_orders add column if not exists work_time text not null default '';
alter table daily_orders add column if not exists work_detail text not null default '';
