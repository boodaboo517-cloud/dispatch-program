-- 개인별 근로계약 근무별 수당 (원). 금액이라 관리자·배차만 읽고 쓴다 (기사·조회 계정에는 내려가지 않음)
create table driver_pay_rates (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null unique references drivers on delete cascade,
  rates jsonb not null default '{}',   -- {"주간근무": 120000, "야간근무": 150000, …}
  memo text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create trigger touch before insert or update on driver_pay_rates for each row execute function touch_row();
create trigger audit after insert or update or delete on driver_pay_rates for each row execute function audit_row();
alter table driver_pay_rates enable row level security;
alter table driver_pay_rates replica identity full;
alter publication supabase_realtime add table driver_pay_rates;
create policy "staff all" on driver_pay_rates for all to authenticated using (is_staff()) with check (is_staff());
