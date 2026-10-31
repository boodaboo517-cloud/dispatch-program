// 엑셀·설정·사용자 권한
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tx, repairSnapshot, type Snapshot } from '../domain/index.ts';
import { BackupError, backupSummary, downloadBackup, lastBackupAt, parseBackup, readBackupFile, uploadPlan } from '../data/backup.ts';
import { emailStatus, lastEmailBackupAt, sendBackupEmail, type EmailStatus } from '../data/emailBackup.ts';
import { savedDemoData, store } from '../data/store.ts';
import { isDemo, supabase } from '../data/supabase.ts';
import { exportSchedule } from '../excel/exportSchedule.ts';
import { downloadTemplates, parseUpload, planUpload, TEMPLATES, type PreviewRow } from '../excel/importer.ts';
import { TZ, dayjs, fmtStamp, seoulToday } from '../lib/time.ts';
import { Editable } from '../ui/Editable.tsx';
import { useRole, useSnap, useStore } from '../ui/hooks.ts';
import { setting } from '../ui/labels.ts';
import { InstallCard } from '../ui/InstallCard.tsx';
import { saveSetting } from '../ui/Phrases.tsx';
import { reloadFresh } from '../lib/recover.ts';
import { alertPrefs, canVibrate, ringAlert, setAlertPref } from '../lib/alerts.ts';
import { Sheet, useSheet } from '../ui/Sheet.tsx';
import { NewPasswordSheet } from './LoginPage.tsx';
import { ProfileSheet } from './ProfileSheet.tsx';


function UploadPreview({ rows, data, close }: { rows: PreviewRow[]; data: Awaited<ReturnType<typeof parseUpload>>; close: () => void }) {
  const errors = rows.filter((r) => r.errors.length).length;
  const apply = () => {
    store.run((tx: Tx) => void planUpload(store.getState().snap, data, tx));
    store.toast(`${rows.length - errors}행 반영${errors ? ` · 오류 ${errors}행 제외` : ''}`);
    close();
  };
  return (
    <Sheet title="업로드 미리보기" onClose={close} footer={<button className="primary" disabled={rows.length === errors} onClick={apply}>오류 없는 {rows.length - errors}행 반영</button>}>
      {errors > 0 && <div className="banner red">오류 {errors}행 (빨간 줄) — 반영되지 않습니다</div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="simple small">
          <thead><tr><th>시트</th><th>행</th><th>처리</th><th>내용</th><th>오류</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className={r.errors.length ? 'err' : ''}><td>{r.sheet}</td><td>{r.line}</td><td>{r.action}</td><td>{r.values.filter(Boolean).join(' · ')}</td><td>{r.errors.join(', ')}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Sheet>
  );
}

/** 데모 데이터를 서버로 옮기기: 외래키 순서대로 500행씩 upsert (같은 id 는 덮어쓰기라 여러 번 해도 중복 없음) */
async function uploadToServer(snap: Snapshot, onProgress: (text: string) => void) {
  for (const { table, rows } of uploadPlan(snap)) {
    for (let i = 0; i < rows.length; i += 500) {
      onProgress(`${table} ${Math.min(i + 500, rows.length)}/${rows.length}`);
      const chunk = rows.slice(i, i + 500);
      const { error } = table === 'settings'
        ? await supabase!.from(table).upsert(chunk, { onConflict: 'key', defaultToNull: false })
        : await supabase!.from(table).upsert(chunk, { defaultToNull: false });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }
}

function DataPanel() {
  const snap = useSnap();
  const sheet = useSheet();
  const { admin } = useRole();
  const [progress, setProgress] = useState('');
  const last = lastBackupAt();
  // 서버 연결 전에 이 기기에서 쓰던 데모 데이터 (파일 없이 바로 옮기기)
  const [localDemo, setLocalDemo] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (!isDemo && admin) void savedDemoData().then((s) => setLocalDemo(s ? repairSnapshot(s) : null));
  }, [admin]);

  const moveLocalDemo = async () => {
    if (!localDemo) return;
    const ok = await sheet.confirm({
      title: '이 기기의 데모 데이터를 서버로 옮기기',
      message: `서버 연결 전에 이 기기에서 입력한 데이터\n${backupSummary(localDemo)}\n\n서버에 같은 항목이 있으면 이 내용으로 덮어씁니다. 서버에만 있는 데이터는 그대로 둡니다.`,
      actions: [{ label: '서버로 옮기기', value: 'y', kind: 'primary' }],
    });
    if (!ok) return;
    try {
      await uploadToServer(localDemo, setProgress);
      setProgress('');
      await store.refresh();
      store.toast('서버로 옮겼습니다');
    } catch (e) {
      setProgress('');
      store.toast(`옮기기 실패 — ${e instanceof Error ? e.message : e}. 다시 실행해도 중복되지 않습니다.`, 'error');
    }
  };

  const restore = async (file: File | undefined) => {
    if (!file) return;
    let parsed;
    try {
      parsed = parseBackup(await readBackupFile(file));
    } catch (e) {
      store.toast(e instanceof BackupError ? e.message : String(e), 'error');
      return;
    }
    const { snapshot, exportedAt } = parsed;
    if (isDemo) {
      const ok = await sheet.confirm({
        title: '백업 불러오기',
        message: `${fmtStamp(exportedAt)} 백업\n${backupSummary(snapshot)}\n\n지금 이 기기의 데이터는 백업 내용으로 바뀝니다.`,
        actions: [{ label: '불러오기', value: 'y', kind: 'primary' }],
      });
      if (ok) {
        store.replaceSnapshot(snapshot);
        store.toast('백업을 불러왔습니다');
      }
      return;
    }
    const ok = await sheet.confirm({
      title: '데모 데이터를 서버로 옮기기',
      message: `${fmtStamp(exportedAt)} 백업\n${backupSummary(snapshot)}\n\n서버에 같은 항목이 있으면 백업 내용으로 덮어씁니다. 서버에만 있는 데이터는 그대로 둡니다.`,
      actions: [{ label: '서버로 옮기기', value: 'y', kind: 'primary' }],
    });
    if (!ok) return;
    try {
      await uploadToServer(snapshot, setProgress);
      setProgress('');
      await store.refresh();
      store.toast('서버로 옮겼습니다');
    } catch (e) {
      setProgress('');
      store.toast(`옮기기 실패 — ${e instanceof Error ? e.message : e}. 다시 실행해도 중복되지 않습니다.`, 'error');
    }
  };

  const reset = async () => {
    const kind = await sheet.confirm({
      title: '데이터 초기화',
      message: '이 기기의 데이터를 모두 지우고 다시 시작합니다. 먼저 백업 파일을 저장해 두세요.',
      actions: [
        { label: '기본 명단만으로 시작 (실제 입력용)', value: 'base', kind: 'danger' },
        { label: '예시 데이터로 시작 (연습용)', value: 'sample' },
      ],
    });
    if (kind) await store.resetDemo(kind as 'base' | 'sample');
  };

  return (
    <div className="card">
      <h3>데이터 보관</h3>
      {isDemo && (
        <div className="banner yellow small">
          데모 모드는 <b>이 기기 브라우저에만</b> 저장됩니다. 다른 휴대폰·PC와 공유되지 않고, 브라우저 데이터를 지우면 사라집니다.
          <b> 백업 파일을 자주 저장</b>해 두세요. 나중에 서버(Supabase)를 연결하면 이 파일로 그대로 옮길 수 있습니다.
        </div>
      )}
      {localDemo && (
        <div className="banner blue small">
          이 기기에 서버 연결 전 데모 데이터가 남아 있습니다 ({backupSummary(localDemo)}).
          <div style={{ marginTop: 6 }}>
            <button className="primary" onClick={() => void moveLocalDemo()}>⬆ 이 기기의 데모 데이터 서버로 옮기기</button>
            <button style={{ marginLeft: 6 }} onClick={() => { downloadBackup(localDemo); store.toast('데모 데이터를 백업 파일로 저장했습니다'); }}>💾 데모 데이터 파일로 저장</button>
          </div>
        </div>
      )}
      <p className="muted small">지금 데이터: {backupSummary(snap)}<br />마지막 백업: {last ? fmtStamp(last) : '없음'}</p>
      <div className="row wrap">
        <button className="primary" onClick={() => { downloadBackup(snap); store.toast('백업 파일을 저장했습니다 (다운로드 폴더)'); }}>💾 백업 파일 저장</button>
        {(isDemo || admin) && (
          <label><button onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement).click()}>{isDemo ? '📂 백업 불러오기' : '⬆ 백업 파일 서버로 올리기'}</button>
            <input hidden type="file" accept=".json,.gz,application/json,application/gzip" onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = ''; }} /></label>
        )}
        {isDemo && <button className="danger" onClick={reset}>초기화</button>}
      </div>
      {progress && <p className="muted">옮기는 중… {progress}</p>}
      {!isDemo && admin && <ServerBackups />}
      <EmailBackup />
    </div>
  );
}

/** 서버 자동 백업 (매일 02:00, 30일 보관) — 날짜별로 내려받기 · 지금 백업 */
function ServerBackups() {
  const [list, setList] = useState<{ id: number; created_at: string; summary: string; size_bytes: number }[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const { data, error } = await supabase!.from('server_backups').select('id,created_at,summary,size_bytes').order('created_at', { ascending: false }).limit(30);
    setMissing(!!error);
    setList((data ?? []) as never);
  };
  useEffect(() => { void load(); }, []);
  const download = async (id: number, at: string) => {
    setBusy(true);
    const { data, error } = await supabase!.from('server_backups').select('data').eq('id', id).single();
    setBusy(false);
    if (error || !data) return store.toast(`받지 못했습니다: ${error?.message ?? ''}`, 'error');
    const blob = new Blob([JSON.stringify((data as { data: unknown }).data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gyeongmin-server-backup-${dayjs(at).tz(TZ).format('YYYYMMDD-HHmm')}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  const now = async () => {
    setBusy(true);
    const { error } = await supabase!.rpc('admin_backup_now');
    setBusy(false);
    if (error) return store.toast(error.message, 'error');
    store.toast('서버에 백업했습니다');
    void load();
  };
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 10 }}>
      <b>🗄 서버 자동 백업 (매일 새벽 2시 · 30일 보관)</b>
      {missing ? (
        <p className="muted small">아직 켜지지 않았습니다. Supabase에 자동 백업 SQL(20261025000020)을 한 번 실행하면 매일 새벽 2시에 자동으로 백업됩니다.</p>
      ) : (
        <>
          <p className="muted small">휴대폰·PC가 꺼져 있어도 서버가 스스로 백업합니다. 되돌릴 때는 받은 파일을 위 "⬆ 백업 파일 서버로 올리기"로 올리면 됩니다.</p>
          {list?.slice(0, 7).map((b) => (
            <div key={b.id} className="row" style={{ alignItems: 'center', minHeight: 40, borderBottom: '1px solid #f1f5f9' }}>
              <span className="grow small"><b>{dayjs(b.created_at).tz(TZ).format('M/D (dd) HH:mm')}</b> <span className="muted">{b.summary} · {Math.max(1, Math.round(b.size_bytes / 1024))}KB</span></span>
              <button className="chip" disabled={busy} onClick={() => void download(b.id, b.created_at)}>⬇ 받기</button>
            </div>
          ))}
          {list && !list.length && <p className="muted small">아직 백업이 없습니다. 오늘 새벽 2시에 처음 만들어집니다.</p>}
          <button style={{ marginTop: 6 }} disabled={busy} onClick={() => void now()}>지금 서버에 백업</button>
        </>
      )}
    </div>
  );
}

/** 일정 변경 알림: 소리 · 진동 · 휴대폰 알림창 (이 기기에만 저장) */
function AlertSettings() {
  const [p, setP] = useState(alertPrefs());
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  const toggle = (k: 'sound' | 'vibrate') => { setAlertPref(k, !p[k]); setP(alertPrefs()); };
  return (
    <div className="card">
      <h3>🔔 일정 변경 알림</h3>
      <p className="muted small">내 배차가 추가·변경·취소되면 알려 줍니다. 이 휴대폰에만 적용됩니다.</p>
      <label className="row" style={{ alignItems: 'center', gap: 8, minHeight: 44 }}>
        <input type="checkbox" checked={p.sound} onChange={() => toggle('sound')} style={{ width: 24, height: 24 }} /><span style={{ fontSize: 17 }}>🔊 알림 소리</span>
      </label>
      <label className="row" style={{ alignItems: 'center', gap: 8, minHeight: 44 }}>
        <input type="checkbox" checked={p.vibrate} disabled={!canVibrate()} onChange={() => toggle('vibrate')} style={{ width: 24, height: 24 }} />
        <span style={{ fontSize: 17 }}>📳 진동</span>{!canVibrate() && <span className="muted small">(이 기기·브라우저는 진동을 지원하지 않습니다 — 아이폰 등)</span>}
      </label>
      <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
        <button onClick={() => ringAlert('테스트 알림', true)}>▶ 소리·진동 시험</button>
        {perm !== 'granted' && 'Notification' in window && (
          <button onClick={() => void Notification.requestPermission().then(setPerm)}>📲 휴대폰 알림창 허용</button>
        )}
        {perm === 'granted' && <span className="small" style={{ color: 'var(--green)', alignSelf: 'center' }}>✓ 휴대폰 알림창 허용됨</span>}
      </div>
      <p className="muted small" style={{ marginTop: 6 }}>앱을 켜 두었거나 잠깐 다른 앱으로 넘어간 동안 알립니다. 앱을 완전히 닫으면 다음에 열 때 "변경 내역"에서 볼 수 있습니다.</p>
    </div>
  );
}

function EmailBackup() {
  const snap = useSnap();
  const [st, setSt] = useState<EmailStatus | null | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const last = lastEmailBackupAt();
  useEffect(() => {
    void emailStatus().then(setSt);
  }, []);
  const send = async () => {
    setSending(true);
    try {
      await sendBackupEmail(snap);
      store.toast('백업을 이메일로 보냈습니다');
    } catch (e) {
      store.toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSending(false);
    }
  };
  return (
    <div style={{ borderTop: '1px solid #eee', marginTop: 12, paddingTop: 10 }}>
      <b>📧 이메일 백업 (일주일마다 자동)</b>
      {st === undefined && <p className="muted small">확인 중…</p>}
      {st === null && <p className="muted small">이메일 발송 기능은 Vercel에 배포된 주소에서만 동작합니다.</p>}
      {st && !st.configured && (
        <div className="banner yellow small">
          아직 설정되지 않았습니다. Vercel → 프로젝트 → Settings → Environment Variables 에
          <b> RESEND_API_KEY</b>, <b>BACKUP_EMAIL_TO</b>(받을 이메일)를 넣고 다시 배포하세요. (README "이메일 백업" 참고)
        </div>
      )}
      {st?.configured && (
        <>
          <p className="small">받는 주소: <b>{st.to.join(', ')}</b><br />마지막 발송: {last ? fmtStamp(last) : '없음'} · 7일이 지나면 앱을 열 때 자동으로 보냅니다.</p>
          <button disabled={sending} onClick={send}>{sending ? '보내는 중…' : '📧 지금 이메일로 보내기'}</button>
        </>
      )}
    </div>
  );
}

export function SettingsPage() {
  const snap = useSnap();
  const nav = useNavigate();
  const sheet = useSheet();
  const { staff, admin } = useRole();
  const session = useStore((s) => s.session);
  const pending = useStore((s) => s.pending);
  const today = seoulToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const suggestions = snap.product_suggestions.filter((s) => s.status === 'pending');

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = await parseUpload(file);
      if (!Object.keys(data).length) return store.toast(`시트 이름이 ${Object.keys(TEMPLATES).join('/')} 중 하나여야 합니다`, 'warn');
      const rows = planUpload(snap, data);
      sheet.open((c) => <UploadPreview rows={rows} data={data} close={c} />);
    } catch (e) {
      store.toast(`엑셀을 읽지 못했습니다: ${e instanceof Error ? e.message : e}`, 'error');
    }
  };

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      {!staff && <button style={{ marginBottom: 8 }} onClick={() => nav('/driver')}>← 내 배차</button>}
      {staff && !admin && <button style={{ marginBottom: 8 }} onClick={() => nav('/')}>← 배차</button>}
      {/* 설정은 관리자만. 배차 담당·기사는 내 계정(알림·비밀번호·로그아웃)만 */}
      <h2>{admin ? '더보기 · 설정' : '내 계정'}</h2>
      {admin && (
        <div className="menu-tiles">
          <button onClick={() => nav('/fleet/vehicles')}><span className="ic">🚚</span>차량·기사</button>
          <button onClick={() => nav('/fleet/ships')}><span className="ic">⛴</span>선박 등록·수정</button>
          <button onClick={() => nav('/fleet/field')}><span className="ic">👷</span>현장근무 설정</button>
          <button onClick={() => nav('/revenue')}><span className="ic">💰</span>매출</button>
          <button onClick={() => nav('/driver')}><span className="ic">📱</span>기사 화면 보기</button>
        </div>
      )}

      <InstallCard />

      <AlertSettings />

      <div className="card row" style={{ alignItems: 'center' }}>
        <div className="grow"><b>앱 버전</b><div className="muted small">{__APP_VERSION__}</div></div>
        <button onClick={() => void reloadFresh()}>최신 버전 받기</button>
      </div>

      {admin && suggestions.length > 0 && (
        <div className="card"><h3>기사 제안 승인 대기 {suggestions.length}건</h3>
          {suggestions.map((s) => <div key={s.id} className="list-item" onClick={() => nav(`/products/${s.product_id}`)}>{snap.products.find((p) => p.id === s.product_id)?.name} · {s.kind === 'photo' ? '사진' : s.payload}</div>)}
        </div>
      )}

      {admin && <div className="card">
        <h3>엑셀 다운로드 (일정표 양식)</h3>
        <div className="row wrap">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} />~
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} />
        </div>
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button onClick={() => exportSchedule(snap, today, today)}>오늘</button>
          <button onClick={() => exportSchedule(snap, from, to < from ? from : to)}>기간</button>
          <button onClick={() => exportSchedule(snap, dayjs(today).startOf('month').format('YYYY-MM-DD'), dayjs(today).endOf('month').format('YYYY-MM-DD'))}>이번 달</button>
        </div>
      </div>}

      {admin && (
        <div className="card">
          <h3>엑셀 업로드 (거래처·품목 / 차량·기사 / 오더 일괄)</h3>
          <p className="muted small">양식을 받아 채운 뒤 올리면 미리보기 후 반영합니다. 오류 행은 빨간색으로 표시되고 반영되지 않습니다.</p>
          <div className="row wrap">
            <button onClick={() => downloadTemplates()}>⬇ 업로드 양식</button>
            <label><button onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement).click()}>⬆ 엑셀 올리기</button>
              <input hidden type="file" accept=".xlsx" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
          </div>
        </div>
      )}

      {admin && (
        <div className="card">
          <h3>설정</h3>
          <Editable label="상단 안내문구" value={setting(snap, 'header_notice', '')} onSave={(v) => saveSetting('header_notice', v)} />
          <Editable label="배차 담당 전화" value={setting(snap, 'dispatcher_phone', '')} type="tel" onSave={(v) => saveSetting('dispatcher_phone', v)} />
          <Editable label="자주 쓰는 비고" value={setting<string[]>(snap, 'memo_phrases', []).join(', ')} multiline onSave={(v) => saveSetting('memo_phrases', v.split(',').map((x) => x.trim()).filter(Boolean))} />
          <Editable label="기사 제안 허용" value={String(setting(snap, 'driver_suggestions', false))} options={[{ value: 'false', label: '아니오 (관리자·배차만 수정)' }, { value: 'true', label: '예 (사진·주의사항 제안 → 승인 후 반영)' }]} onSave={(v) => saveSetting('driver_suggestions', v === 'true')} />
        </div>
      )}
      {(admin || isDemo) && <DataPanel />}
      {admin && supabase && (
        <div className="card">
          <h3>👥 사용자 관리</h3>
          <p className="muted small">아이디 만들기 · 비활성화 · 비밀번호 초기화 · 권한</p>
          <button className="primary" onClick={() => nav('/users')}>사용자 관리 열기</button>
        </div>
      )}

      <div className="card">
        <h3>계정</h3>
        <p>{session?.name} · {{ admin: '관리자', dispatcher: '일반(배차)', viewer: '조회(기사)' }[session?.role ?? 'viewer']} {isDemo && <span className="badge warn">데모 모드 (이 기기에만 저장)</span>}</p>
        {!isDemo && <p className="muted small">전송 대기 {pending}건 {pending ? '— 연결되면 자동 동기화' : ''}</p>}
        <div className="row wrap">
          {!isDemo && session?.userId && <button onClick={() => sheet.open((close) => <ProfileSheet userId={session.userId} self close={close} />)}>✏ 내 정보 수정</button>}
          {!isDemo && <button onClick={() => sheet.open((close) => <NewPasswordSheet close={close} />)}>🔑 비밀번호 바꾸기</button>}
          <button className="danger" onClick={async () => { await supabase?.auth.signOut(); await store.stop(); localStorage.removeItem('demo-role'); location.href = '/'; }}>로그아웃</button>
        </div>
      </div>
    </div>
  );
}
