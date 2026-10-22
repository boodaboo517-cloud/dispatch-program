// 정비: 요약(정비 중 / 2주 내 예정 / 기한 지남) → 정비 중 → 다가오는 정비·검사 → 차량별 이력
import { useState } from 'react';
import {
  MAINTENANCE_KINDS, activeRepair, addDays, consumableStatus, deleteMaintenance, newId, nextDue, saveMaintenance,
  type MaintenanceKind, type MaintenanceRecord, type MaintenanceSchedule,
} from '../domain/index.ts';
import { store } from '../data/store.ts';
import { exportMaintenance } from '../excel/exportOther.ts';
import { fmtDate, seoulToday } from '../lib/time.ts';
import { useRole, useSnap } from '../ui/hooks.ts';
import { driverName, setting, vehicleNo } from '../ui/labels.ts';
import { compressAndUpload, Photo } from '../ui/media.tsx';
import { Sheet, useSheet } from '../ui/Sheet.tsx';

function RecordSheet({ rec, close }: { rec: MaintenanceRecord; close: () => void }) {
  const snap = useSnap();
  const [r, setR] = useState(rec);
  const shops = setting<string[]>(snap, 'maintenance_shops', []);
  const set = (p: Partial<MaintenanceRecord>) => setR({ ...r, ...p });
  const isNew = !snap.maintenance_records.some((x) => x.id === rec.id);
  return (
    <Sheet title={isNew ? '정비 등록' : '정비 수정'} onClose={close} footer={<>
      {!isNew && <button className="danger" onClick={() => { store.run((tx) => deleteMaintenance(tx, r.id)); close(); }}>삭제</button>}
      <button className="primary" onClick={() => { if (!r.vehicle_id) return store.toast('차량을 고르세요', 'warn'); store.run((tx) => saveMaintenance(tx, r)); close(); }}>저장</button>
    </>}>
      <label className="field"><span>차량</span><select value={r.vehicle_id} onChange={(e) => set({ vehicle_id: e.target.value })}><option value="">선택</option>{snap.vehicles.map((v) => <option key={v.id} value={v.id}>{v.short_no} {v.vehicle_type}</option>)}</select></label>
      <label className="field"><span>정비 종류</span><select value={r.kind} onChange={(e) => set({ kind: e.target.value as MaintenanceKind })}>{MAINTENANCE_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
      <label className="field"><span>정비업체</span><input list="mshops" value={r.shop} onChange={(e) => set({ shop: e.target.value })} /><datalist id="mshops">{shops.map((s) => <option key={s} value={s} />)}</datalist></label>
      <div className="row">
        <label className="field grow"><span>시작일</span><input type="date" value={r.start_date} onChange={(e) => set({ start_date: e.target.value })} /></label>
        <label className="field grow"><span>종료일 (비우면 정비 중)</span><input type="date" value={r.end_date ?? ''} onChange={(e) => set({ end_date: e.target.value || null })} /></label>
      </div>
      <div className="row">
        <label className="field grow"><span>금액</span><input inputMode="numeric" value={r.cost ?? ''} onChange={(e) => set({ cost: e.target.value ? Number(e.target.value.replace(/,/g, '')) : null })} /></label>
      </div>
      <label className="field"><span>담당 직원 (정비실 입고 처리 시 현장근무에 자동 표시)</span>
        <select value={r.staff_id ?? ''} onChange={(e) => set({ staff_id: e.target.value || null })}><option value="">-</option>{snap.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      </label>
      <label className="field"><span>메모</span><textarea value={r.memo} onChange={(e) => set({ memo: e.target.value })} /></label>
      <div className="photos">{r.photo_paths.map((p) => <Photo key={p} path={p} />)}</div>
      <label><button onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement).click()}>📷 사진·영수증</button>
        <input hidden type="file" accept="image/*" multiple onChange={async (e) => {
          const paths: string[] = [];
          for (const f of Array.from(e.target.files ?? [])) paths.push(await compressAndUpload(f, `maintenance/${r.vehicle_id || 'x'}`));
          set({ photo_paths: [...r.photo_paths, ...paths] });
        }} />
      </label>
    </Sheet>
  );
}

function ScheduleSheet({ s, close }: { s: MaintenanceSchedule; close: () => void }) {
  const snap = useSnap();
  const [x, setX] = useState(s);
  const set = (p: Partial<MaintenanceSchedule>) => setX({ ...x, ...p });
  return (
    <Sheet title="정비 주기" onClose={close} footer={<button className="primary" onClick={() => { store.run((tx) => (tx.get('maintenance_schedules', x.id) ? tx.update('maintenance_schedules', x.id, x) : tx.insert('maintenance_schedules', x))); close(); }}>저장</button>}>
      <label className="field"><span>차량</span><select value={x.vehicle_id} onChange={(e) => set({ vehicle_id: e.target.value })}><option value="">선택</option>{snap.vehicles.map((v) => <option key={v.id} value={v.id}>{v.short_no}</option>)}</select></label>
      <label className="field"><span>종류</span><select value={x.kind} onChange={(e) => set({ kind: e.target.value as MaintenanceKind })}>{MAINTENANCE_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
      <label className="field"><span>만료일·예정일 직접 지정 (정기검사 등)</span><input type="date" value={x.due_date ?? ''} onChange={(e) => set({ due_date: e.target.value || null })} /></label>
      <div className="row">
        <label className="field grow"><span>주기 (일)</span><input inputMode="numeric" value={x.interval_days ?? ''} onChange={(e) => set({ interval_days: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="field grow"><span>주기 (km)</span><input inputMode="numeric" value={x.interval_km ?? ''} onChange={(e) => set({ interval_km: e.target.value ? Number(e.target.value) : null })} /></label>
      </div>
      <p className="muted small">이력이 등록되면 마지막 정비 기준으로 다음 예정일·km를 자동 계산합니다. 미션오일·타이어 등도 km 주기로 추가할 수 있습니다.</p>
    </Sheet>
  );
}

export function MaintenancePanel() {
  const snap = useSnap();
  const sheet = useSheet();
  const { staff } = useRole();
  const today = seoulToday();
  const [vfilter, setVfilter] = useState('');
  const inRepair = snap.maintenance_records.filter((r) => activeRepair([r], r.vehicle_id, today));
  const dues = snap.maintenance_schedules.map((s) => nextDue(snap, s, today)).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
  const soon = dues.filter((d) => d.state === 'soon');
  const over = dues.filter((d) => d.state === 'overdue');
  const blankRec = (): MaintenanceRecord => ({ id: newId(), vehicle_id: '', kind: '차량 점검', shop: '', start_date: today, end_date: today, odometer_km: null, cost: null, staff_id: null, memo: '', photo_paths: [] });
  const history = snap.maintenance_records.filter((r) => !vfilter || r.vehicle_id === vfilter).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const kmSchedules = snap.maintenance_schedules.filter((s) => s.interval_km);

  return (
    <div>
      <div className="row" style={{ textAlign: 'center' }}>
        <div className="card grow"><div style={{ fontSize: 28, fontWeight: 800, color: 'var(--red)' }}>{inRepair.length}</div>정비 중</div>
        <div className="card grow"><div style={{ fontSize: 28, fontWeight: 800, color: '#a16207' }}>{soon.length}</div>2주 내 예정</div>
        <div className="card grow"><div style={{ fontSize: 28, fontWeight: 800, color: 'var(--red)' }}>{over.length}</div>기한 지남</div>
      </div>
      {staff && <div className="row"><button className="primary grow" onClick={() => sheet.open((c) => <RecordSheet rec={blankRec()} close={c} />)}>＋ 정비 등록</button>
        <button className="grow" onClick={() => sheet.open((c) => <ScheduleSheet s={{ id: newId(), vehicle_id: '', kind: '정기검사', interval_days: 365, interval_km: null, due_date: null }} close={c} />)}>＋ 주기 등록</button></div>}

      <h3>정비 중</h3>
      {inRepair.map((r) => (
        <div key={r.id} className="card" onClick={() => staff && sheet.open((c) => <RecordSheet rec={r} close={c} />)}>
          <b>{vehicleNo(snap, r.vehicle_id)}</b> {r.kind} · {r.shop} <span className="muted">{fmtDate(r.start_date)} ~ {r.end_date ? fmtDate(r.end_date) : '진행 중'}</span>
          {staff && !r.end_date && <button style={{ marginLeft: 8 }} onClick={(e) => { e.stopPropagation(); store.run((tx) => saveMaintenance(tx, { ...r, end_date: today })); }}>오늘 출고</button>}
        </div>
      ))}
      {!inRepair.length && <p className="muted">없음</p>}

      <h3>다가오는 정비·검사</h3>
      {dues.map((d) => (
        <div key={d.schedule.id} className="card" onClick={() => staff && sheet.open((c) => <ScheduleSheet s={d.schedule} close={c} />)} style={{ borderLeft: `6px solid ${d.state === 'overdue' ? 'var(--red)' : d.state === 'soon' ? '#eab308' : '#d1d5db'}` }}>
          <b>{vehicleNo(snap, d.schedule.vehicle_id)}</b> {d.schedule.kind}
          <span className="muted"> {d.dueDate && `${fmtDate(d.dueDate)} (${d.daysLeft! >= 0 ? `${d.daysLeft}일 남음` : `${-d.daysLeft!}일 지남`})`} {d.dueKm != null && `· ${d.dueKm.toLocaleString()}km (${d.kmLeft?.toLocaleString() ?? '?'}km 남음)`}</span>
        </div>
      ))}
      {kmSchedules.length > 0 && (
        <>
          <h3>소모품 km 주기</h3>
          {kmSchedules.map((s) => {
            const c = consumableStatus(snap, s.vehicle_id, s.kind, s.interval_km!, today);
            return (
              <div key={s.id} className="card">
                <b>{vehicleNo(snap, s.vehicle_id)}</b> {s.kind} {c.remainingKm != null ? `${c.remainingKm.toLocaleString()}km 남음` : '기록 없음'}
                {c.ratio != null && <div className={`bar ${c.level}`}><i style={{ width: `${Math.min(100, c.ratio * 100)}%` }} /></div>}
              </div>
            );
          })}
        </>
      )}

      <div className="row"><h3 className="grow">차량별 정비 이력</h3>
        <select style={{ width: 130 }} value={vfilter} onChange={(e) => setVfilter(e.target.value)}><option value="">전체</option>{snap.vehicles.map((v) => <option key={v.id} value={v.id}>{v.short_no}</option>)}</select>
        <button onClick={() => exportMaintenance(snap, addDays(today, -365), today, vfilter || undefined)}>⬇ 엑셀</button>
      </div>
      <table className="simple">
        <thead><tr><th>차량</th><th>종류</th><th>기간</th><th>업체</th><th className="num">금액</th></tr></thead>
        <tbody>
          {history.map((r) => (
            <tr key={r.id} onClick={() => staff && sheet.open((c) => <RecordSheet rec={r} close={c} />)} style={{ cursor: 'pointer' }}>
              <td>{vehicleNo(snap, r.vehicle_id)}</td><td>{r.kind}</td><td>{fmtDate(r.start_date)}{r.end_date && r.end_date !== r.start_date ? `~${fmtDate(r.end_date)}` : !r.end_date ? '~' : ''}</td>
              <td>{r.shop} {r.staff_id && <span className="muted">{driverName(snap, r.staff_id)}</span>}</td><td className="num">{r.cost?.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
