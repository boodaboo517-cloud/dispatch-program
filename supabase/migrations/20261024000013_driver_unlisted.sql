-- 비지정 근무자: 자유롭게 일해서 일정표 근무·대기·휴무 명단에 넣지 않음
alter table drivers add column if not exists unlisted boolean not null default false;
