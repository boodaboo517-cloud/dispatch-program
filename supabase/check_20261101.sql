-- 11/1 업데이트(아이디 로그인 · 동시 수정 · 수정 이력 · 접속 기록) 적용 확인
-- Supabase SQL Editor 에 붙여넣고 Run → 모든 줄이 ✅ 이면 정상. 아무것도 바꾸지 않는 조회 전용.
with c(step, item, ok, info) as (
  select '0. 7일 잠금', '지난 일정 잠금 트리거 5개',
         (select count(*) from pg_trigger where tgname = 'block_old_edits') = 5,
         (select count(*) from pg_trigger where tgname = 'block_old_edits')::text || '개'
  union all
  select '1. 아이디 로그인', 'profiles.login_id 칸',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'login_id'), ''
  union all
  select '1. 아이디 로그인', '계정 만들기 · 아이디 지정 함수',
         to_regprocedure('public.admin_create_user(text,text,text,text)') is not null and to_regprocedure('public.admin_set_login_id(uuid,text)') is not null, ''
  union all
  select '1. 아이디 로그인', '아이디가 지정된 계정 수 (관리자 계정부터 지정하세요)',
         case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'login_id') then false
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from profiles where login_id is not null', false, true, '')))[1]::text::int > 0 end,
         case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'login_id') then ''
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from profiles where login_id is not null', false, true, '')))[1]::text
                   || ' / 전체 ' || (select count(*) from profiles)::text end
  union all
  select '2. 동시 수정', 'edit_base 칸 (8개 표)',
         (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'edit_base') = 8,
         (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'edit_base')::text || '개'
  union all
  select '2. 동시 수정', '충돌 검사 트리거 (8개 표)',
         (select count(*) from pg_trigger where tgname = 'a_edit_conflict') = 8,
         (select count(*) from pg_trigger where tgname = 'a_edit_conflict')::text || '개'
  union all
  select '3. 수정 이력', 'change_log 표', to_regclass('public.change_log') is not null, ''
  union all
  select '3. 수정 이력', '기록 트리거 (7개 표)',
         (select count(*) from pg_trigger where tgname = 'change_log') = 7,
         (select count(*) from pg_trigger where tgname = 'change_log')::text || '개'
  union all
  select '3. 수정 이력', '실시간 전송 (점 표시)',
         exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'change_log'), ''
  union all
  select '3. 수정 이력', '매시간 자동 정리 예약',
         case when to_regclass('cron.job') is null then false
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from cron.job where jobname = ''purge-change-log''', false, true, '')))[1]::text::int > 0 end,
         case when to_regclass('cron.job') is null then 'pg_cron 없음 (조회할 때 정리됨)' else '' end
  union all
  select '3. 수정 이력', '최근 24시간 기록 수 (앱에서 하나 고친 뒤 1 이상이면 정상)',
         case when to_regclass('public.change_log') is null then false
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from change_log where at > now() - interval ''24 hours''', false, true, '')))[1]::text::int > 0 end,
         case when to_regclass('public.change_log') is null then '' else
              (xpath('/row/n/text()', query_to_xml('select count(*) as n from change_log where at > now() - interval ''24 hours''', false, true, '')))[1]::text || '건' end
  union all
  select '4. 접속 기록', 'access_log 표 · 기록 함수',
         to_regclass('public.access_log') is not null and to_regprocedure('public.log_access(text,text)') is not null, ''
  union all
  select '4. 접속 기록', '정리 함수에 접속 기록 포함',
         coalesce((select prosrc like '%access_log%' from pg_proc where proname = 'purge_change_log' limit 1), false), ''
  union all
  select '4. 접속 기록', '최근 24시간 접속 기록 수 (앱을 한 번 열면 1 이상)',
         case when to_regclass('public.access_log') is null then false
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from access_log where at > now() - interval ''24 hours''', false, true, '')))[1]::text::int > 0 end,
         case when to_regclass('public.access_log') is null then '' else
              (xpath('/row/n/text()', query_to_xml('select count(*) as n from access_log where at > now() - interval ''24 hours''', false, true, '')))[1]::text || '건' end
)
select step as "단계", item as "확인 항목", case when ok then '✅' else '❌' end as "결과", info as "내용" from c;
