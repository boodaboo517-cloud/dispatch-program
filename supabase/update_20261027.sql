-- 2026-10-27 업데이트: 벌크 선박 (한 번에 붙여넣고 Run, 두 번 실행해도 괜찮음)

-- 벌크 선박: 차량은 안 타고 화물만 (도착지 하차는 차량 없이 배차 대기)
alter table ships add column if not exists bulk boolean not null default false;
update ships set bulk = true where name like '%벌크%' and not bulk;
-- 성우벌크 · 영진벌크 · 세주벌크가 아직 없으면 추가
insert into ships (name, departs_at, route, arrival_day_offset, sort_order, bulk)
select n, '', 'both', 1, (select coalesce(max(sort_order), 0) + 1 from ships), true
from unnest(array['성우벌크', '영진벌크', '세주벌크']) as n
where not exists (select 1 from ships s where s.name = n);
