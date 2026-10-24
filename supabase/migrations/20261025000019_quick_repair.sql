-- 수리 시간 구분: quick = 경미(1시간 내, 운행 계속) / am = 오전 반나절 / pm = 오후 반나절 / full = 하루 이상(기간 동안 수리)
alter table maintenance_records add column if not exists repair_span text not null default 'full'
  check (repair_span in ('quick', 'am', 'pm', 'full'));
