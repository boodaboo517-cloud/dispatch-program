// 백업 파일을 이메일로 보내기 (Vercel 함수 /api/backup-email → Resend). 일주일마다 앱이 열릴 때 자동 발송.
import type { Snapshot } from '../domain/index.ts';
import { backupStamp, backupSummary, makeBackup } from './backup.ts';

const LAST_EMAIL = 'last-email-backup';
export const WEEK_MS = 7 * 86400000;

async function gzip(text: string): Promise<{ bytes: Uint8Array; gz: boolean }> {
  const raw = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') return { bytes: raw, gz: false };
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), gz: true };
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export interface EmailStatus {
  configured: boolean;
  to: string[];
}

/** 이메일 발송 설정 여부 (Vercel 함수가 없는 곳 — 개발 PC 등 — 에서는 null) */
export async function emailStatus(): Promise<EmailStatus | null> {
  try {
    const r = await fetch('/api/backup-email', { headers: { Accept: 'application/json' } });
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null;
    return (await r.json()) as EmailStatus;
  } catch {
    return null;
  }
}

export async function sendBackupEmail(snap: Snapshot, reason: 'manual' | 'weekly' = 'manual') {
  const { bytes, gz } = await gzip(JSON.stringify(makeBackup(snap)));
  const r = await fetch('/api/backup-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: `gyeongmin-backup-${backupStamp()}.json${gz ? '.gz' : ''}`,
      content: toBase64(bytes),
      summary: backupSummary(snap),
      reason,
    }),
  });
  const j = await r.json().catch(() => ({ ok: false, error: `발송 실패 (${r.status})` }));
  if (!r.ok || !j.ok) throw new Error(j.error ?? `발송 실패 (${r.status})`);
  try {
    localStorage.setItem(LAST_EMAIL, new Date().toISOString());
  } catch {
    /* 기록 못 해도 발송은 됐음 */
  }
}

export function lastEmailBackupAt(): string | null {
  try {
    return localStorage.getItem(LAST_EMAIL);
  } catch {
    return null;
  }
}

export function weeklyEmailDue(now = Date.now()): boolean {
  const last = lastEmailBackupAt();
  return !last || now - new Date(last).getTime() >= WEEK_MS;
}

let triedThisSession = false;

/** 앱이 열릴 때 한 번: 마지막 이메일 백업이 7일 지났고 발송이 설정돼 있으면 자동으로 보낸다 */
export async function autoWeeklyEmail(snap: Snapshot): Promise<'sent' | 'skipped' | Error> {
  if (triedThisSession || !weeklyEmailDue()) return 'skipped';
  triedThisSession = true;
  const st = await emailStatus();
  if (!st?.configured) return 'skipped';
  try {
    await sendBackupEmail(snap, 'weekly');
    return 'sent';
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}
