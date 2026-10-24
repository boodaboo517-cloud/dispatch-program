-- 오전(하차) 기사 칸에 이름 대신 적는 말: "오후도착" (배가 오후에 들어와 오전 일이 없음)
alter table vehicle_days add column if not exists am_label text not null default '';
