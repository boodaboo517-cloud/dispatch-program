// node --experimental-strip-types scripts/gen-seed-sql.ts > supabase/seed.sql
import { seedSnapshot } from '../src/data/seed.ts';
import { WRITE_ORDER } from '../src/domain/batches.ts';

const s = seedSnapshot() as unknown as Record<string, Record<string, unknown>[]>;
const JSON_COLS = new Set(['value', 'extras', 'link_pending', 'arrival_pending', 'port_times']);
const lit = (v: unknown, col = ''): string => {
  if (JSON_COLS.has(col)) return v == null ? 'null' : `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'number')) return `'{${v.join(',')}}'`;
  if (typeof v === 'object' || Array.isArray(v)) return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const out = ['-- 자동 생성: npm run seed:sql (src/data/seed.ts)', 'begin;'];
for (const t of WRITE_ORDER) {
  for (const row of s[t] ?? []) {
    const cols = Object.keys(row);
    out.push(`insert into ${t} (${cols.join(', ')}) values (${cols.map((c) => lit(row[c], c)).join(', ')}) on conflict (id) do nothing;`);
  }
}
out.push('commit;');
console.log(out.join('\n'));
