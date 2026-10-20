-- 매일 새벽 3시(KST) 반복 발주·고정 근무를 오늘+8주까지 연장하고 알림을 만든다.
-- 출항 당일 13시(KST)에는 배차 대기 상차 알림.
--
-- ⚠️ 적용 전에 아래 두 값을 Supabase Vault 에 넣어야 한다 (대시보드 → Project Settings → Vault):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role 키>', 'service_role_key');
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function call_daily_function(task text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/daily-maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := jsonb_build_object('task', task)
  );
end $$;

-- pg_cron 은 UTC: 18:00 UTC = 03:00 KST, 04:00 UTC = 13:00 KST
select cron.schedule('extend-recurring', '0 18 * * *', $$select call_daily_function('extend')$$);
select cron.schedule('waiting-alert', '0 4 * * *', $$select call_daily_function('alerts')$$);
