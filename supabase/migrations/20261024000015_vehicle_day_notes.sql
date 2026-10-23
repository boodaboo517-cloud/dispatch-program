-- 오전(하차)·오후(상차) 칸에 오더 없이 적는 비고
alter table vehicle_days add column if not exists unload_note text not null default '';
alter table vehicle_days add column if not exists load_note text not null default '';
