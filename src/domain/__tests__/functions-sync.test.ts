import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('Edge Function 의 도메인 복사본이 src/domain 과 같다 (npm run sync:functions)', () => {
  const src = 'src/domain';
  const dst = 'supabase/functions/_shared/domain';
  const files = readdirSync(src).filter((f) => f.endsWith('.ts'));
  expect(readdirSync(dst).sort()).toEqual(files.sort());
  for (const f of files) expect(readFileSync(`${dst}/${f}`, 'utf8'), f).toBe(readFileSync(`${src}/${f}`, 'utf8'));
});

it('Supabase 한 번에 설정 파일이 migrations 와 같다 (npm run setup:sql)', () => {
  const dir = 'supabase/migrations';
  const all = readFileSync('supabase/setup_all.sql', 'utf8');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql') && !x.includes('_scheduler'))) {
    expect(all, f).toContain(readFileSync(`${dir}/${f}`, 'utf8').trim());
  }
});
