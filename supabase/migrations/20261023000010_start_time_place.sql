-- 출근 시간·장소 (제주: 부두, 차고지, 본사, 함덕, 고산, 현장 …)
alter table vehicle_days add column if not exists start_time text not null default '';
alter table vehicle_days add column if not exists start_place text not null default '';
