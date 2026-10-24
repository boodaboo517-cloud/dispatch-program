// supabase/migrations 를 한 파일로 묶는다 (SQL Editor 에 한 번에 붙여넣기용). 새벽 스케줄러(Vault 필요)는 뺀다.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = 'supabase/migrations';
const files = readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.includes('_scheduler')).sort();
const out = [
  '-- 경민물류 배차: Supabase 처음 설정 (SQL Editor 에 통째로 붙여넣고 Run). npm run setup:sql 로 다시 만든다.',
  '-- 새벽 스케줄러(20261020000003_scheduler.sql)는 Vault 설정 뒤 따로 실행.',
  '',
  ...files.map((f) => `-- ===== ${f} =====\n${readFileSync(`${dir}/${f}`, 'utf8').trim()}\n`),
].join('\n');
writeFileSync('supabase/setup_all.sql', out);
console.log(`${files.length} files → supabase/setup_all.sql`);
