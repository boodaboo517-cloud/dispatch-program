-- 기사 비고·근무 기록, 선박 기항지별 하행 시간, 오더 상차지/하차지·당일 왕복

alter table drivers add column if not exists memo text not null default '';

create table driver_work_logs (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  driver_id uuid not null references drivers on delete cascade,
  work_types text[] not null default '{}',   -- 주간근무, 야간근무, 특근, 출장, 장거리, 단거리, 야간단거리, 시간외근무
  memo text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (driver_id, date)
);
create index on driver_work_logs (date);

create trigger touch before insert or update on driver_work_logs for each row execute function touch_row();
create trigger audit after insert or update or delete on driver_work_logs for each row execute function audit_row();
alter table driver_work_logs enable row level security;
alter table driver_work_logs replica identity full;
alter publication supabase_realtime add table driver_work_logs;
create policy "read" on driver_work_logs for select to authenticated using (true);
create policy "staff insert" on driver_work_logs for insert to authenticated with check (is_staff());
create policy "staff update" on driver_work_logs for update to authenticated using (is_staff()) with check (is_staff());
create policy "staff delete" on driver_work_logs for delete to authenticated using (is_staff());

-- departs_at = 제주 출발(상행), port_times = [{"port":"목포","time":"01:00"}, …] 기항지별 하행 출발
alter table ships add column if not exists port_times jsonb not null default '[]';

alter table daily_orders
  add column if not exists pickup_place text not null default '',
  add column if not exists dropoff_place text not null default '',
  add column if not exists same_day boolean not null default false;
