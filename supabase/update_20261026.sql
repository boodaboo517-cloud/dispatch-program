-- 2026-10-26 업데이트: 현장근무 오전·오후·종일 (붙여넣고 Run, 두 번 실행해도 괜찮음)

-- 현장근무 시간: 빈 글자 = 종일, am = 오전만, pm = 오후만 (현장 직원이 반나절 기사 배차, 기사가 반나절 현장 지원)
alter table field_assignments add column if not exists part text not null default '' check (part in ('', 'am', 'pm'));
