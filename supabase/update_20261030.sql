-- 2026-10-30 업데이트: 선박 운송 방식 대기 (한 번에 붙여넣고 Run, 두 번 실행해도 괜찮음)

-- 선박 출발: 제주 쪽 출발 항구(비우면 제주) · 출발 시간이 다음 날(익일)인지. 육지 항구별 익일은 port_times 안 next_day
alter table ships add column if not exists depart_port text not null default '';
alter table ships add column if not exists depart_next_day boolean not null default false;

-- 선박 운송 방식 "대기": 아직 배를 안 탐(선박 미정) · 차량·짐 그 지역에 그대로
alter table ships add column if not exists wait boolean not null default false;
