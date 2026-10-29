-- 선박 운송 방식 "대기": 아직 배를 안 탐(선박 미정) · 차량·짐 그 지역에 그대로
alter table ships add column if not exists wait boolean not null default false;
