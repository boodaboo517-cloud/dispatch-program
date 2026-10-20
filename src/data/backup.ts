// 데이터 백업·복원 — 데모(이 기기에만 저장) 데이터를 파일로 보관하고, 나중에 Supabase 로 그대로 옮긴다.
import { TABLES, WRITE_ORDER, emptySnapshot, type Snapshot, type TableName } from '../domain/index.ts';

export const BACKUP_APP = 'gyeongmin-dispatch';

export interface BackupFile {
  app: typeof BACKUP_APP;
  version: 1;
  exported_at: string;
  snapshot: Snapshot;
}

export function makeBackup(snap: Snapshot, now = new Date().toISOString()): BackupFile {
  return { app: BACKUP_APP, version: 1, exported_at: now, snapshot: snap };
}

export class BackupError extends Error {}

/** 백업 파일 읽기 + 검사. 빠진 표는 빈 목록으로 채운다 */
export function parseBackup(text: string): { snapshot: Snapshot; exportedAt: string } {
  let j: Partial<BackupFile>;
  try {
    j = JSON.parse(text);
  } catch {
    throw new BackupError('백업 파일이 아닙니다 (JSON 형식 아님)');
  }
  if (j.app !== BACKUP_APP || !j.snapshot || typeof j.snapshot !== 'object') {
    throw new BackupError('경민물류 배차 백업 파일이 아닙니다');
  }
  const snap = emptySnapshot();
  for (const t of TABLES) {
    const rows = (j.snapshot as unknown as Record<string, unknown>)[t];
    if (rows === undefined) continue;
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || typeof (r as { id?: unknown }).id !== 'string')) {
      throw new BackupError(`백업 파일의 "${t}" 내용이 올바르지 않습니다`);
    }
    (snap as unknown as Record<string, unknown[]>)[t] = rows;
  }
  return { snapshot: snap, exportedAt: j.exported_at ?? '' };
}

export function backupSummary(s: Snapshot) {
  return `거래처 ${s.clients.length} · 품목 ${s.products.length} · 차량 ${s.vehicles.length} · 직원 ${s.drivers.length} · 오더 ${s.daily_orders.length}`;
}

/**
 * 서버 업로드 순서: 외래키 때문에 부모 표 먼저, 같은 표 안에서도 참조되는 행을 먼저.
 * (연결 하차는 원본 상차 뒤, 선박 이어진 줄은 전날 줄 뒤)
 */
export function uploadPlan(s: Snapshot): { table: TableName; rows: Record<string, unknown>[] }[] {
  const out: { table: TableName; rows: Record<string, unknown>[] }[] = [];
  for (const t of WRITE_ORDER) {
    let rows = [...(s[t] as unknown as Record<string, unknown>[])];
    if (t === 'daily_orders') rows.sort((a, b) => Number(!!a.linked_from_id) - Number(!!b.linked_from_id));
    if (t === 'vehicle_days') rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    // 데모에서 만든 행은 서버 사용자 id 가 없다 → 수정자는 비우고 시각은 서버가 채움
    rows = rows.map(({ updated_at: _a, updated_by: _b, ...r }) => r);
    if (rows.length) out.push({ table: t, rows });
  }
  return out;
}

export function backupStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 백업 파일 읽기: 이메일로 받은 .json.gz(압축) 도 그대로 받는다 */
export async function readBackupFile(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new BackupError('이 브라우저는 압축 백업(.gz)을 열 수 없습니다. 최신 크롬에서 열어 주세요');
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(buf);
}

export function downloadBackup(snap: Snapshot) {
  const blob = new Blob([JSON.stringify(makeBackup(snap))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gyeongmin-backup-${backupStamp()}.json`; // 한글 파일명은 일부 브라우저에서 "download" 로 바뀌어 영문으로
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
  try {
    localStorage.setItem('last-backup', new Date().toISOString());
  } catch {
    /* 저장 안 되면 알림만 계속 뜬다 */
  }
}

/** 마지막 백업 (파일 저장 · 이메일 발송 중 늦은 쪽) */
export function lastBackupAt(): string | null {
  try {
    const xs = [localStorage.getItem('last-backup'), localStorage.getItem('last-email-backup')].filter(Boolean) as string[];
    return xs.sort().pop() ?? null;
  } catch {
    return null;
  }
}

/** 마지막 백업이 3일 넘었거나 한 번도 안 했으면 알림 */
export function backupOverdue(snap: Snapshot, now = Date.now()): boolean {
  if (!snap.daily_orders.length && snap.clients.length <= 5) return false;
  const last = lastBackupAt();
  return !last || now - new Date(last).getTime() > 3 * 86400000;
}
