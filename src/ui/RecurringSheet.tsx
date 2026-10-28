// 반복 발주 등록·변경·종료 (적용 시작일 + 미리보기)
import { useMemo, useState } from 'react';
import {
  RecurringRuleError, activeVersion, addDays, buildBoard, planCreateRecurring, planRecurringChange, planRecurringCleanup, planRecurringEnd, recurringOrdersLeft,
  previewRecurringChange, summarizeVersion, weekdaysLabel,
  type Kind, type RecurringOrder, type ShipTag, type VersionFields, type Weekday, type Zone,
} from '../domain/index.ts';
import { store } from '../data/store.ts';
import { fmtDate, seoulToday } from '../lib/time.ts';
import { useSnap } from './hooks.ts';
import { ZONE_LABEL, kindLabel, shipText, vehicleNo } from './labels.ts';
import { QtyInput } from './QtyInput.tsx';
import { Seg, WeekdayChips } from './Picker.tsx';
import { usePickers } from './pickers.tsx';
import { Sheet } from './Sheet.tsx';

type Mode = 'create' | 'change' | 'end';

export function RecurringSheet(p: {
  close: () => void;
  mode: Mode;
  recurring?: RecurringOrder;
  clientId: string;
  productId: string | null;
  initial?: Partial<VersionFields> & { zone?: Zone; kind?: Kind };
}) {
  const snap = useSnap();
  const pick = usePickers();
  const today = seoulToday();
  const cur = p.recurring ? activeVersion(snap, p.recurring.id, today) : undefined;
  const product = snap.products.find((x) => x.id === (p.recurring?.product_id ?? p.productId));
  const [zone, setZone] = useState<Zone>(p.recurring?.zone ?? p.initial?.zone ?? 'jeju');
  const [kind, setKind] = useState<Kind>(p.recurring?.kind ?? p.initial?.kind ?? 'unload');
  const [f, setF] = useState<VersionFields>({
    weekdays: cur?.weekdays ?? p.initial?.weekdays ?? [],
    quantity: cur?.quantity ?? p.initial?.quantity ?? product?.default_quantity ?? null,
    unit: cur?.unit ?? p.initial?.unit ?? product?.default_unit ?? '',
    region: cur?.region ?? p.initial?.region ?? product?.default_region ?? '',
    ship: cur?.ship ?? p.initial?.ship ?? null,
    ship_tag: cur?.ship_tag ?? p.initial?.ship_tag ?? '',
    vehicle_id: cur?.vehicle_id ?? p.initial?.vehicle_id ?? null,
    memo: cur?.memo ?? p.initial?.memo ?? '',
  });
  const [start, setStart] = useState(p.mode === 'end' ? today : p.mode === 'change' ? addDays(today, 1) : today);
  const set = (x: Partial<VersionFields>) => setF({ ...f, ...x });
  // 종료할 때 배차하거나 고친 오더도 함께 지우기 (기본: 함께 지움 — 짐이 끊긴 경우가 대부분)
  const [includeEdited, setIncludeEdited] = useState(true);

  const preview = useMemo(() => {
    try {
      if (p.mode === 'change' && p.recurring) return { kind: 'change' as const, ...previewRecurringChange(snap, { recurringId: p.recurring.id, fields: f, startDate: start, today }) };
      if (p.mode === 'end' && p.recurring) return {
        kind: 'end' as const,
        ...planRecurringEnd(snap, { recurringId: p.recurring.id, endDate: start, today, includeEdited }),
        edited: planRecurringEnd(snap, { recurringId: p.recurring.id, endDate: start, today }).keptManual,
      };
      return null;
    } catch (e) {
      return { kind: 'error' as const, message: e instanceof RecurringRuleError ? e.message : String(e) };
    }
  }, [snap, f, start, today, p.mode, p.recurring, includeEdited]);

  const save = () => {
    try {
      let res;
      if (p.mode === 'create') {
        if (!f.weekdays.length) return store.toast('요일을 하나 이상 고르세요', 'warn');
        res = planCreateRecurring(snap, { client_id: p.clientId, product_id: p.productId, zone, kind, fields: f, startDate: start, today });
        store.commit(res.mutations);
        store.toast(`반복 발주 등록 · 앞으로 8주 ${res.created}건 생성`);
      } else if (p.mode === 'change' && p.recurring) {
        res = planRecurringChange(snap, { recurringId: p.recurring.id, fields: f, startDate: start, today });
        store.commit(res.mutations);
        store.toast(`${fmtDate(start)}부터 변경 · ${res.removed}건 삭제 · ${res.created}건 생성${res.keptManual ? ` · 직접 수정 ${res.keptManual}건은 유지됨` : ''}`);
      } else if (p.mode === 'end' && p.recurring) {
        res = planRecurringEnd(snap, { recurringId: p.recurring.id, endDate: start, today, includeEdited });
        store.commit(res.mutations);
        store.toast(`${fmtDate(start)}까지 하고 종료 · ${res.removed}건 삭제${res.keptManual ? ` · 직접 수정 ${res.keptManual}건 유지됨` : ''}`);
      }
      p.close();
    } catch (e) {
      store.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const title = { create: '매주 반복 등록', change: '반복 발주 변경', end: '반복 발주 종료' }[p.mode];
  return (
    <Sheet title={title} onClose={p.close} footer={<button className="primary" disabled={preview?.kind === 'error'} onClick={save}>{p.mode === 'end' ? '종료' : '저장'}</button>}>
      <p className="muted">{snap.clients.find((c) => c.id === p.clientId)?.name} · {product?.name ?? '품목 없음'}</p>
      {p.mode === 'create' && (
        <div className="row" style={{ margin: '8px 0' }}>
          <Seg value={zone} onChange={setZone} options={[{ value: 'land', label: '육지' }, { value: 'jeju', label: '제주' }]} />
          <Seg value={kind} onChange={setKind} options={[{ value: 'unload', label: kindLabel(zone, 'unload') }, { value: 'load', label: kindLabel(zone, 'load') }]} />
        </div>
      )}
      {p.mode !== 'end' && (
        <>
          <label className="field"><span>요일</span><WeekdayChips value={f.weekdays} onChange={(v) => set({ weekdays: v as Weekday[] })} /></label>
          <div className="field"><span className="muted small">수량 (10파렛트 · 3대 처럼 써도 됨)</span>
            <QtyInput quantity={f.quantity} unit={f.unit} onChange={(quantity, unit) => set({ quantity, unit })} />
          </div>
          <label className="field"><span>지역</span><input value={f.region} onChange={(e) => set({ region: e.target.value })} /></label>
          <div className="editable" onClick={async () => { const r = await pick.ship(zone, { ship: f.ship, tag: f.ship_tag }, kind === 'load' ? 'departure' : 'arrival'); if (r) set({ ship: r.ship, ship_tag: r.tag as ShipTag }); }}>
            <span className="k">선박</span><span className="v">{shipText(f.ship, f.ship_tag) || '-'}</span><span className="muted">변경 ›</span>
          </div>
          <div className="editable" onClick={async () => {
            const v = await pick.vehicle(buildBoard(snap, start), zone);
            set({ vehicle_id: v });
          }}>
            <span className="k">차량</span><span className="v">{vehicleNo(snap, f.vehicle_id) || '나중에 배차'}</span><span className="muted">변경 ›</span>
          </div>
          <label className="field"><span>비고</span><input value={f.memo} onChange={(e) => set({ memo: e.target.value })} /></label>
        </>
      )}
      <label className="field">
        <span>{p.mode === 'end' ? '마지막 날 (이날까지 유지)' : '적용 시작일 (오늘 이후만)'}</span>
        <input type="date" value={start} min={p.mode === 'end' ? addDays(today, -1) : today} onChange={(e) => setStart(e.target.value)} />
      </label>

      {preview?.kind === 'error' && <div className="banner red">{preview.message}</div>}
      {preview?.kind === 'change' && (
        <div className="card" style={{ background: '#f9fafb' }}>
          <b>미리보기</b>
          <table className="simple" style={{ marginTop: 6 }}>
            <thead><tr><th /><th>~{fmtDate(preview.until)} (어제까지)</th><th>{fmtDate(preview.startDate)}부터</th></tr></thead>
            <tbody>
              {(['weekdays', 'quantity', 'ship', 'region', 'memo'] as const).map((k) => (
                <tr key={k}>
                  <td className="muted">{{ weekdays: '요일', quantity: '수량', ship: '선박', region: '지역', memo: '비고' }[k]}</td>
                  <td>{preview.before?.[k] || '-'}</td>
                  <td style={{ fontWeight: preview.before?.[k] !== preview.after[k] ? 800 : 400, color: preview.before?.[k] !== preview.after[k] ? 'var(--red)' : undefined }}>{preview.after[k] || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">기존 내용 유지: 지난 오더 {preview.pastUntouched}건 (변경 없음)<br />
            시작일 이후 자동 오더 {preview.removed}건 삭제 → 새 내용으로 {preview.created}건 생성
            {preview.keptManual > 0 && <><br /><b>직접 수정 {preview.keptManual}건은 유지됨</b></>}</p>
        </div>
      )}
      {preview?.kind === 'end' && (
        <div className="card" style={{ background: '#f9fafb' }}>
          {preview.edited > 0 && (
            <label className="row" style={{ alignItems: 'center', gap: 8, minHeight: 44 }}>
              <input type="checkbox" checked={includeEdited} onChange={(e) => setIncludeEdited(e.target.checked)} style={{ width: 22, height: 22 }} />
              <span>배차했거나 고친 오더 {preview.edited}건도 함께 지우기</span>
            </label>
          )}
          {fmtDate(start)}까지 유지 · 이후 일정 <b>{preview.removed}건 삭제</b> (반대편 연결 하차 포함)
          {preview.keptManual > 0 && <> · <b>직접 수정 {preview.keptManual}건은 유지됨</b></>}
        </div>
      )}
    </Sheet>
  );
}

/** 이미 끝난 반복 발주가 남긴 오늘 이후 일정 일괄 삭제 */
function LeftoverButton({ recId }: { recId: string }) {
  const snap = useSnap();
  const today = seoulToday();
  const left = recurringOrdersLeft(snap, recId, today);
  if (!left) return null;
  return (
    <button className="grow danger" onClick={() => {
      if (!confirm(`이 반복 발주로 남아 있는 오늘(${fmtDate(today)}) 이후 일정 ${left}건을 모두 지울까요? (배차한 것·반대편 연결 하차 포함)`)) return;
      const res = planRecurringCleanup(store.getState().snap, { recurringId: recId, fromDate: today, today });
      store.commit(res.mutations);
      store.toast(`남은 일정 ${res.removed}건 삭제`);
    }}>남은 일정 {left}건 지우기</button>
  );
}

/** 거래처·품목 화면의 반복 발주 목록 */
export function RecurringList({ clientId, productId, open }: { clientId: string; productId?: string; open: (mode: Mode, rec?: RecurringOrder) => void }) {
  const snap = useSnap();
  const today = seoulToday();
  const recs = snap.recurring_orders.filter((r) => r.client_id === clientId && (!productId || r.product_id === productId));
  return (
    <div>
      {recs.map((r) => {
        const v = activeVersion(snap, r.id, today);
        const sum = v ? summarizeVersion(v) : null;
        const last = snap.recurring_order_versions.filter((x) => x.recurring_order_id === r.id).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
        return (
          <div key={r.id} className="card">
            <div className="row">
              <b className="grow">{snap.products.find((x) => x.id === r.product_id)?.name ?? '품목 없음'} · {ZONE_LABEL[r.zone]} {kindLabel(r.zone, r.kind)}</b>
              {!r.active && <span className="badge">종료</span>}
            </div>
            {v ? (
              <>
                <div className="weekdays" style={{ margin: '6px 0' }}>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => <button key={d} className={v.weekdays.includes(d as Weekday) ? 'on' : ''} style={{ pointerEvents: 'none' }}>{weekdaysLabel([d as Weekday])}</button>)}
                </div>
                <div className="muted">{sum!.quantity} · {sum!.region} · 선박 {sum!.ship}{v.vehicle_id ? ` · 차량 ${vehicleNo(snap, v.vehicle_id)}` : ''}</div>
                <div className="muted small">적용 중: {fmtDate(v.effective_from)}부터{v.effective_to ? ` ~ ${fmtDate(v.effective_to)}` : ''}</div>
              </>
            ) : <div className="muted">{last ? `${fmtDate(last.effective_to ?? last.effective_from)}에 종료됨` : ''}</div>}
            {last && v && last.id !== v.id && <div className="banner yellow small">예약 변경: {fmtDate(last.effective_from)}부터 {summarizeVersion(last).weekdays} {summarizeVersion(last).quantity}</div>}
            <div className="row" style={{ marginTop: 6 }}>
              <button className="grow" onClick={() => open('change', r)}>변경</button>
              {r.active && <button className="grow danger" onClick={() => open('end', r)}>종료</button>}
              {!r.active && <LeftoverButton recId={r.id} />}
            </div>
          </div>
        );
      })}
      {!recs.length && <p className="muted">반복 발주 없음</p>}
    </div>
  );
}
