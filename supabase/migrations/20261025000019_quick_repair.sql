-- 경미 수리: 1시간 안에 끝나 그날 운행에 지장 없음 (정비 기록만 남고 차량은 막지 않음)
alter table maintenance_records add column if not exists quick boolean not null default false;
