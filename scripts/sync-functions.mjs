// src/domain → supabase/functions/_shared/domain 복사 (Edge Function 이 앱과 같은 로직을 쓰도록)
import { cpSync, rmSync } from 'node:fs';
const dst = 'supabase/functions/_shared/domain';
rmSync(dst, { recursive: true, force: true });
cpSync('src/domain', dst, { recursive: true, filter: (p) => !p.includes('__tests__') });
console.log('copied src/domain →', dst);
