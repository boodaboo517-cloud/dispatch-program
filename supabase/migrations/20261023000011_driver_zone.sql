-- 직원·기사 근무 지역 (일정표 휴무 줄을 육지·제주로 나눔)
alter table drivers add column if not exists zone text check (zone in ('land', 'jeju'));
update drivers set zone = case when (shift || ' ' || affiliation) ~ '(상주|부산|서울|목포)' then 'land' else 'jeju' end where zone is null;
