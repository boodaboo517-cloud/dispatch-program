// 엑셀·설정·사용자 권한
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tx, maintenanceAlerts, newId, type Role } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { isDemo, supabase } from '../data/supabase.ts';
import { exportSchedule } from '../excel/exportSchedule.ts';
import { downloadTemplates, parseUpload, planUpload, TEMPLATES, type PreviewRow } from '../excel/importer.ts';
import { dayjs, seoulToday } from '../lib/time.ts';
import { Editable } from '../ui/Editable.tsx';
import { useRole, useSnap, useStore } from '../ui/hooks.ts';
import { setting } from '../ui/labels.ts';
import { Sheet, useSheet } from '../ui/Sheet.tsx';

function saveSetting(key: string, value: unknown) {
  store.run((tx) => {
    const cur = tx.list('settings').find((s) => s.key === key);
    if (cur) tx.update('settings', cur.id, { value });
    else tx.insert('settings', { id: newId(), key, value });
  });
}

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

function UsersPanel() {
  const snap = useSnap();
  const [users, setUsers] = useState<{ id: string; name: string; role: Role; driver_id: string | null }[]>([]);
  const load = () => supabase?.from('profiles').select('id,name,role,driver_id').then(({ data }) => setUsers((data ?? []) as never));
  useEffect(() => {
    void load();
  }, []);
  const update = async (id: string, p: Record<string, unknown>) => {
    const { error } = await supabase!.from('profiles').update(p).eq('id', id);
    if (error) store.toast(error.message, 'error');
    void load();
  };
  return (
    <div className="card">
      <h3>사용자 권한</h3>
      <p className="muted small">새로 가입한 사람은 "조회(기사)"로 시작합니다. 기사 계정은 연결된 기사의 배차만 "내 배차"에 보입니다.</p>
      {users.map((u) => (
        <div key={u.id} className="row wrap" style={{ borderBottom: '1px solid #eee', padding: '6px 0' }}>
          <b className="grow">{u.name}</b>
          <select style={{ width: 130 }} value={u.role} onChange={(e) => update(u.id, { role: e.target.value })}>
            <option value="admin">관리자</option><option value="dispatcher">배차</option><option value="viewer">조회(기사)</option>
          </select>
          <select style={{ width: 150 }} value={u.driver_id ?? ''} onChange={(e) => update(u.id, { driver_id: e.target.value || null })}>
            <option value="">기사 연결 없음</option>{snap.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      ))}
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
  const alerts = maintenanceAlerts(snap, today);
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
      <h2>더보기 · 설정</h2>
      <div className="row wrap">
        <button className="grow" onClick={() => nav('/fleet/vehicles')}>🚚 차량·기사·선박</button>
        <button className="grow" onClick={() => nav('/fleet/maintenance')}>🔧 정비</button>
        <button className="grow" onClick={() => nav('/fleet/field')}>👷 현장근무 설정</button>
        {staff && <button className="grow" onClick={() => nav('/revenue')}>💰 매출</button>}
        <button className="grow" onClick={() => nav('/driver')}>📱 기사 화면 보기</button>
      </div>

      {staff && alerts.length > 0 && (
        <div className="card"><h3>알림</h3>{alerts.map((a, i) => <div key={i} className={`banner ${a.level === 'over' ? 'red' : 'yellow'}`}>{a.message}</div>)}</div>
      )}
      {staff && suggestions.length > 0 && (
        <div className="card"><h3>기사 제안 승인 대기 {suggestions.length}건</h3>
          {suggestions.map((s) => <div key={s.id} className="list-item" onClick={() => nav(`/products/${s.product_id}`)}>{snap.products.find((p) => p.id === s.product_id)?.name} · {s.kind === 'photo' ? '사진' : s.payload}</div>)}
        </div>
      )}

      <div className="card">
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
      </div>

      {staff && (
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
          <Editable label="정비업체" value={setting<string[]>(snap, 'maintenance_shops', []).join(', ')} onSave={(v) => saveSetting('maintenance_shops', v.split(',').map((x) => x.trim()).filter(Boolean))} />
          <Editable label="오일 주기 기본 km" value={setting(snap, 'oil_interval_km', 15000)} type="number" onSave={(v) => saveSetting('oil_interval_km', Number(v) || 15000)} />
          <Editable label="기사 제안 허용" value={String(setting(snap, 'driver_suggestions', false))} options={[{ value: 'false', label: '아니오 (관리자·배차만 수정)' }, { value: 'true', label: '예 (사진·주의사항 제안 → 승인 후 반영)' }]} onSave={(v) => saveSetting('driver_suggestions', v === 'true')} />
        </div>
      )}
      {admin && supabase && <UsersPanel />}

      <div className="card">
        <h3>계정</h3>
        <p>{session?.name} · {{ admin: '관리자', dispatcher: '배차', viewer: '조회(기사)' }[session?.role ?? 'viewer']} {isDemo && <span className="badge warn">데모 모드 (이 기기에만 저장)</span>}</p>
        {!isDemo && <p className="muted small">전송 대기 {pending}건 {pending ? '— 연결되면 자동 동기화' : ''}</p>}
        <div className="row wrap">
          {isDemo && <button onClick={() => confirm('데모 데이터를 처음 상태로 되돌릴까요?') && store.resetDemo()}>데모 초기화</button>}
          <button className="danger" onClick={async () => { await supabase?.auth.signOut(); await store.stop(); localStorage.removeItem('demo-role'); location.href = '/'; }}>로그아웃</button>
        </div>
      </div>
    </div>
  );
}
