// Vercel 함수: 백업 파일을 지정된 이메일로 보낸다 (Resend 이메일 API 사용).
// 환경변수 (Vercel → Settings → Environment Variables):
//   RESEND_API_KEY   — resend.com 에서 만든 API 키 (필수)
//   BACKUP_EMAIL_TO  — 받을 이메일 주소, 쉼표로 여러 개 가능 (필수, 서버에만 저장되어 화면에서 바꿀 수 없음)
//   BACKUP_EMAIL_FROM — 보내는 주소 (선택, 기본 onboarding@resend.dev — 이 경우 Resend 가입 이메일로만 발송 가능)

const MAX_BYTES = 4_000_000; // Vercel 함수 요청 크기 제한(4.5MB) 안쪽

function config() {
  const key = process.env.RESEND_API_KEY;
  const to = (process.env.BACKUP_EMAIL_TO ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return { key, to, from: process.env.BACKUP_EMAIL_FROM || '경민물류 배차 <onboarding@resend.dev>' };
}

const mask = (e) => e.replace(/^(.).*?(.)@/, (_m, a, b) => `${a}***${b}@`);

export async function GET() {
  const { key, to } = config();
  return Response.json({ configured: !!key && to.length > 0, to: to.map(mask) });
}

/** @param {Request} request */
export async function POST(request) {
  const { key, to, from } = config();
  if (!key || !to.length) return Response.json({ ok: false, error: '이메일 발송이 설정되지 않았습니다 (RESEND_API_KEY, BACKUP_EMAIL_TO)' }, { status: 503 });
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) return Response.json({ ok: false, error: '백업 파일이 너무 큽니다 (사진이 많으면 직접 저장하세요)' }, { status: 413 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: '잘못된 요청' }, { status: 400 });
  }
  const filename = String(body.filename ?? '');
  if (!/^gyeongmin-backup-[\d-]+\.json(\.gz)?$/.test(filename) || typeof body.content !== 'string' || !body.content) {
    return Response.json({ ok: false, error: '백업 파일이 아닙니다' }, { status: 400 });
  }
  const when = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'short' }).format(new Date());
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: `[경민물류 배차] ${body.reason === 'weekly' ? '주간 자동 백업' : '백업'} ${when}`,
      text: [
        `경민물류 배차 데이터 백업입니다 (${when}).`,
        body.summary ? `내용: ${String(body.summary).slice(0, 300)}` : '',
        '',
        '복원: 앱 → 설정 → 데이터 보관 → 백업 불러오기 에서 첨부 파일을 고르세요.',
        '이 메일은 지우지 말고 보관해 두세요.',
      ].filter((x) => x !== '').join('\n'),
      attachments: [{ filename, content: body.content }],
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    return Response.json({ ok: false, error: `발송 실패 (${r.status}) ${detail.slice(0, 200)}` }, { status: 502 });
  }
  return Response.json({ ok: true });
}
