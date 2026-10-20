import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('Edge Function 의 도메인 복사본이 src/domain 과 같다 (npm run sync:functions)', () => {
  const src = 'src/domain';
  const dst = 'supabase/functions/_shared/domain';
  const files = readdirSync(src).filter((f) => f.endsWith('.ts'));
  expect(readdirSync(dst).sort()).toEqual(files.sort());
  for (const f of files) expect(readFileSync(`${dst}/${f}`, 'utf8'), f).toBe(readFileSync(`${src}/${f}`, 'utf8'));
});
