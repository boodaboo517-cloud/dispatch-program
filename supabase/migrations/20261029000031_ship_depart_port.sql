-- 선박 출발: 제주 쪽 출발 항구(비우면 제주) · 출발 시간이 다음 날(익일)인지. 육지 항구별 익일은 port_times 안 next_day
alter table ships add column if not exists depart_port text not null default '';
alter table ships add column if not exists depart_next_day boolean not null default false;
