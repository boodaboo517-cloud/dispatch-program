-- 기사 팀 (기사 선택 목록을 팀별로 묶어 보여 줌. 비우면 근무조로 묶음)
alter table drivers add column if not exists team text not null default '';
