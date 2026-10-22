-- 현장 근무지를 일정표의 육지 / 제주 표 중 어디 아래에 보일지
alter table field_sites add column if not exists zone text check (zone in ('land', 'jeju'));
update field_sites set zone = case when name like '%목포%' then 'land' else 'jeju' end where zone is null;
