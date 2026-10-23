-- 근무현황: "근무일 아님" 지정, 시간외근무 시간, 그날 시간외 금액(관리자·배차 전용)
alter table driver_work_logs add column if not exists day_status text not null default '' check (day_status in ('', 'nonwork'));
alter table driver_work_logs add column if not exists overtime_hours numeric;

create table if not exists driver_day_pay (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  driver_id uuid not null references drivers on delete cascade,
  amount numeric not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (driver_id, date)
);
create index if not exists driver_day_pay_date on driver_day_pay (date);

create trigger touch before insert or update on driver_day_pay for each row execute function touch_row();
create trigger audit after insert or update or delete on driver_day_pay for each row execute function audit_row();
alter table driver_day_pay enable row level security;
alter table driver_day_pay replica identity full;
alter publication supabase_realtime add table driver_day_pay;
create policy "staff all" on driver_day_pay for all to authenticated using (is_staff()) with check (is_staff());
