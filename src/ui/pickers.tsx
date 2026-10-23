// 빈칸 탭 → 그 칸에 맞는 등록 목록 (아래에서 올라오는 시트). 모두 Promise 로 결과를 돌려준다.
import { useState } from 'react';
import {
  DAY_STATUS_LABEL, MAINTENANCE_KINDS, ON_CALL_SHIFT, SHIP_TAG_PRESETS, driverGroup, addDays, composeShipTag, shipChoices, splitShipTag, isDriverWorking, newId, vehicleChoices,
  type Board, type DayStatus, type MaintenanceKind, type Product, type ShipTag, type Snapshot, type Zone,
} from '../domain/index.ts';
import { store } from '../data/store.ts';
import { STORAGE_LABEL, ZONE_LABEL, setting } from './labels.ts';
import { PickerList, Seg, type PickSection } from './Picker.tsx';
import { Sheet, useSheet } from './Sheet.tsx';
import { WorkTypeSheet } from './WorkTypeSheet.tsx';
import { PhraseChips } from './Phrases.tsx';
import { ShipEditSheet, blankShip } from './ShipEditSheet.tsx';
import { useRole, useSnap } from './hooks.ts';

export interface ClientPick {
  /** "비고만 적기"를 고름 (오더 없이 칸에 비고만) */
  noteOnly?: boolean;
  client_id: string | null;
  client_text: string;
  product: Product | null;
  product_text: string;
}

const snap = () => store.getState().snap;

/** 이 차량에 자주 쓴 거래처 / 최근 거래처 */
function frequentClients(s: Snapshot, vehicleId: string | null) {
  const cnt = new Map<string, number>();
  for (const o of s.daily_orders) if (o.client_id && vehicleId && o.vehicle_id === vehicleId) cnt.set(o.client_id, (cnt.get(o.client_id) ?? 0) + 1);
  const frequent = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  const recent: string[] = [];
  for (const o of [...s.daily_orders].sort((a, b) => (b.updated_at ?? b.date).localeCompare(a.updated_at ?? a.date))) {
    if (o.client_id && !recent.includes(o.client_id)) recent.push(o.client_id);
    if (recent.length >= 5) break;
  }
  return { frequent, recent };
}

function ClientProductSheet(p: { vehicleId: string | null; startClient?: { id: string; text: string }; allowNote?: boolean; close: () => void; done: (r: ClientPick | null) => void }) {
  const s = snap();
  const [client, setClient] = useState<{ id: string | null; text: string } | null>(p.startClient ?? null);
  const finish = (r: ClientPick | null) => {
    p.done(r);
    p.close();
  };

  if (!client) {
    const { frequent, recent } = frequentClients(s, p.vehicleId);
    const item = (id: string) => {
      const c = s.clients.find((x) => x.id === id)!;
      const n = s.products.filter((x) => x.client_id === id).length;
      return { id, label: c.name, sub: `품목 ${n}개${c.memo ? ' · ' + c.memo : ''}` };
    };
    const sections: PickSection[] = [
      { label: '이 차량에 자주', items: frequent.filter((id) => s.clients.some((c) => c.id === id)).map(item) },
      { label: '최근', items: recent.filter((id) => s.clients.some((c) => c.id === id)).map(item) },
      { label: '전체 거래처', items: [...s.clients].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((c) => item(c.id)) },
    ];
    return (
      <Sheet title="거래처 선택" onClose={() => finish(null)} flush>
        <PickerList
          sections={sections}
          top={p.allowNote ? <div className="list-item" onClick={() => finish({ noteOnly: true, client_id: null, client_text: '', product: null, product_text: '' })}><span><b>📝 비고만 적기</b> <span className="muted small">오더 없이 이 칸에 메모만</span></span></div> : undefined}
          onPick={(it) => setClient({ id: it.id, text: it.label })}
          free={{ label: '직접 쓰기', onFree: (t) => t.trim() && finish({ client_id: null, client_text: t.trim(), product: null, product_text: '' }) }}
          create={{
            label: '새 거래처',
            onCreate: (t) => {
              const name = t.trim() || prompt('새 거래처 이름')?.trim();
              if (!name) return;
              const id = newId();
              store.run((tx) => tx.insert('clients', { id, name, manager: '', phone: '', default_ship: null, memo: '' }));
              setClient({ id, text: name });
            },
          }}
        />
      </Sheet>
    );
  }

  const products = s.products.filter((x) => x.client_id === client.id);
  return (
    <Sheet title={`${client.text || s.clients.find((x) => x.id === client.id)?.name || ""} · 품목`} onClose={() => finish(null)} flush right={<button className="ghost" onClick={() => setClient(null)}>◀ 거래처</button>}>
      <PickerList
        key={client.id ?? client.text}
        sections={[{
          label: '등록 품목',
          items: products.map((x) => ({
            id: x.id,
            label: x.name,
            sub: [x.default_region, x.default_quantity != null ? `${x.default_quantity}${x.default_unit}` : '', STORAGE_LABEL[x.storage]].filter(Boolean).join(' · '),
          })),
        }]}
        onPick={(it) => finish({ client_id: client.id, client_text: '', product: products.find((x) => x.id === it.id)!, product_text: '' })}
        top={<div className="list-item" onClick={() => finish({ client_id: client.id, client_text: '', product: null, product_text: '' })}><span className="muted">품목 없이 거래처만 입력</span></div>}
        free={{ label: '품목 직접 쓰기', onFree: (t) => finish({ client_id: client.id, client_text: '', product: null, product_text: t.trim() }) }}
        create={client.id ? {
          label: '새 품목',
          onCreate: (t) => {
            const name = t.trim() || prompt('새 품목 이름')?.trim();
            if (!name) return;
            const prod: Product = {
              id: newId(), client_id: client.id!, name, default_region: '', default_quantity: null, default_unit: '',
              pickup_address: '', pickup_lat: null, pickup_lng: null, pickup_note: '', dropoff_address: '', dropoff_lat: null,
              dropoff_lng: null, dropoff_note: '', pickup_contact_name: '', pickup_contact_phone: '', dropoff_contact_name: '',
              dropoff_contact_phone: '', storage: 'ambient', temp_min: null, temp_max: null, caution: '',
            };
            store.run((tx) => tx.insert('products', prod));
            finish({ client_id: client.id, client_text: '', product: prod, product_text: '' });
          },
        } : undefined}
      />
    </Sheet>
  );
}

function ShipSheet(p: { zone: Zone | null; which: 'arrival' | 'departure'; current: { ship: string | null; tag: ShipTag }; close: () => void; done: (r: { ship: string | null; tag: ShipTag } | null) => void }) {
  const s = useSnap(); // 여기서 새 선박을 등록하면 목록이 바로 갱신되도록
  const sheet = useSheet();
  const { staff } = useRole();
  const init = splitShipTag(p.current.tag);
  const [base, setBase] = useState<string>((SHIP_TAG_PRESETS as readonly string[]).includes(init.base) ? init.base : '');
  const [booker, setBooker] = useState(init.booker);
  const tag: ShipTag = composeShipTag(base, booker);
  const finish = (r: { ship: string | null; tag: ShipTag } | null) => {
    p.done(r);
    p.close();
  };
  const choices = shipChoices(s.ships, p.zone, p.which);
  const fromJeju = (p.zone === 'jeju' && p.which === 'departure') || (p.zone === 'land' && p.which === 'arrival');
  return (
    <Sheet title="선박 선택" onClose={() => finish(null)} flush>
      <div style={{ padding: '8px 12px' }}>
        <Seg value={base} onChange={setBase} options={[{ value: '', label: '표시 없음' }, ...SHIP_TAG_PRESETS.map((t) => ({ value: t, label: t }))]} />
        <input style={{ marginTop: 6 }} value={booker} onChange={(e) => setBooker(e.target.value)} placeholder="다른 물류업체가 예약해 준 배면 업체 이름 (예: 대한물류)" />
        {booker.trim() && <div className="small" style={{ marginTop: 4 }}>표시: <b>{tag}</b></div>}
      </div>
      <PickerList
        sections={[{
          label: fromJeju ? '선박 · 제주 출발(상행) 시간' : '선박 · 기항지별 하행 출발 시간',
          items: choices.map((c) => ({
            id: c.value + c.ship.id,
            label: c.label,
            search: c.value,
            sub: c.time || '시간 미정',
            right: c.ship.arrival_day_offset !== 1 ? <span className="badge warn">+{c.ship.arrival_day_offset}일 도착</span> : undefined,
          })),
        }]}
        onPick={(it) => finish({ ship: choices.find((c) => c.value + c.ship.id === it.id)!.value, tag })}
        free={{ label: '직접 쓰기 (예: 제주로지 예약)', onFree: (t) => t.trim() && finish({ ship: t.trim(), tag }) }}
        top={<>
          {p.current.ship && <div className="list-item" onClick={() => finish({ ship: null, tag: '' })}><span style={{ color: 'var(--red)' }}>선박 지우기 (현재: {p.current.ship})</span></div>}
          {p.which === 'departure' && (
            <div style={{ padding: '6px 12px' }}>
              <PhraseChips settingKey="ship_phrases" label="자주 쓰는 문구 · 📅 익일선적 = 다음 날 선적(+2일 도착), ⏸ 대기 = 배 안 탐" onPick={(ph) => finish({ ship: ph, tag })}
                fixed={<>
                  <button type="button" className="chip" onClick={() => finish({ ship: '익일선적', tag })}>📅 익일선적</button>
                  <button type="button" className="chip" onClick={() => finish({ ship: '대기', tag })}>⏸ 대기</button>
                </>} />
            </div>
          )}
          {staff && <div className="list-item" onClick={() => sheet.open((c) => <ShipEditSheet ship={blankShip(s.ships.length)} close={c} />)}><span style={{ color: 'var(--blue)' }}>＋ 새 선박 등록 (선박명·시간)</span></div>}
        </>}
      />
    </Sheet>
  );
}

function TextSheet(p: { title: string; initial: string; settingKey: string; close: () => void; done: (r: string | null) => void }) {
  const [v, setV] = useState(p.initial);
  const finish = (r: string | null) => {
    p.done(r);
    p.close();
  };
  return (
    <Sheet title={p.title} onClose={() => finish(null)} footer={<><button onClick={() => finish('')}>비우기</button><button className="primary" onClick={() => finish(v)}>입력</button></>}>
      <textarea value={v} onChange={(e) => setV(e.target.value)} style={{ marginTop: 10 }} />
      <div style={{ marginTop: 8 }}>
        <PhraseChips settingKey={p.settingKey} label="자주 쓰는 문구 (누르면 넣기)" onPick={(ph) => setV((x) => (x ? `${x} ${ph}` : ph))} />
      </div>
    </Sheet>
  );
}

export interface StatusResult {
  status: DayStatus;
  memo: string;
  maintenance?: { kind: MaintenanceKind; shop: string; end_date: string | null };
  action?: 'add-unload' | 'add-load' | 'move-zone';
}

function StatusSheet(p: { date: string; zone: Zone | null; current: { status: DayStatus | 'field'; memo: string }; staff: boolean; close: () => void; done: (r: StatusResult | null) => void }) {
  const s = snap();
  const [status, setStatus] = useState<DayStatus>(p.current.status === 'field' ? 'other' : p.current.status || 'empty');
  const [memo, setMemo] = useState(p.current.memo);
  const [kind, setKind] = useState<MaintenanceKind>('차량 점검');
  const [shop, setShop] = useState('');
  const [end, setEnd] = useState(p.date);
  const shops = setting<string[]>(s, 'maintenance_shops', []);
  const finish = (r: StatusResult | null) => {
    p.done(r);
    p.close();
  };
  return (
    <Sheet
      title="차량 상태"
      onClose={() => finish(null)}
      footer={p.staff ? <button className="primary" onClick={() => finish({ status, memo, maintenance: status === 'repair' ? { kind, shop, end_date: end || null } : undefined })}>저장</button> : undefined}
    >
      {p.staff && (
        <>
          <div className="row" style={{ margin: '10px 0' }}>
            <button className="grow" onClick={() => finish({ status: '', memo: '', action: 'add-unload' })}>＋ {p.zone === 'jeju' ? '오전' : '하차'} 추가</button>
            <button className="grow" onClick={() => finish({ status: '', memo: '', action: 'add-load' })}>＋ {p.zone === 'jeju' ? '오후' : '상차'} 추가</button>
          </div>
          <Seg value={status as Exclude<DayStatus, ''>} onChange={setStatus} options={(Object.keys(DAY_STATUS_LABEL) as Exclude<DayStatus, ''>[]).map((k) => ({ value: k, label: DAY_STATUS_LABEL[k] }))} />
          <label className="field"><span>메모 (예: 목포 대기 · 내일 상차)</span><input value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
          {status === 'repair' && (
            <div className="card" style={{ background: '#fef2f2' }}>
              <div className="muted">정비 등록과 같이 저장됩니다 (기간 동안 매일 수리 표시)</div>
              <label className="field"><span>정비 종류</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as MaintenanceKind)}>{MAINTENANCE_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
              </label>
              <label className="field"><span>정비업체</span>
                <input list="shops" value={shop} onChange={(e) => setShop(e.target.value)} />
                <datalist id="shops">{shops.map((x) => <option key={x} value={x} />)}</datalist>
              </label>
              <label className="field"><span>종료 예정일 (비우면 정비 중 계속)</span><input type="date" value={end} min={p.date} onChange={(e) => setEnd(e.target.value)} /></label>
            </div>
          )}
          <button style={{ width: '100%', marginTop: 8 }} onClick={() => finish({ status: '', memo: '', action: 'move-zone' })}>
            위치 변경 → {p.zone === 'land' ? ZONE_LABEL.jeju : ZONE_LABEL.land}
          </button>
        </>
      )}
      {!p.staff && <p>{memo || '내용 없음'}</p>}
    </Sheet>
  );
}

export const EXTERNAL_HIRED = '__hired__';
export const EXTERNAL_SHIPPER = '__shipper__';
/** 배차 대기 짐: 차량 대신 날짜를 옮김 */
export const MOVE_DATE = '__move_date__';

export function usePickers() {
  const sheet = useSheet();
  const ask = <T,>(render: (close: () => void, done: (v: T) => void) => React.ReactNode) =>
    new Promise<T>((resolve) => sheet.open((close) => render(close, resolve)));

  return {
    /** startClient 를 주면 품목 고르기부터 (등록된 오더의 품목만 바꿀 때) */
    clientProduct: (vehicleId: string | null, startClient?: { id: string; text: string }, allowNote = false) =>
      ask<ClientPick | null>((close, done) => <ClientProductSheet vehicleId={vehicleId} startClient={startClient} allowNote={allowNote} close={close} done={done} />),

    ship: (zone: Zone | null, current: { ship: string | null; tag: ShipTag }, which: 'arrival' | 'departure' = 'departure') =>
      ask<{ ship: string | null; tag: ShipTag } | null>((close, done) => <ShipSheet zone={zone} which={which} current={current} close={close} done={done} />),

    memo: (initial: string, title = '비고') =>
      ask<string | null>((close, done) => <TextSheet title={title} initial={initial} settingKey={title === '업무' ? 'task_phrases' : 'memo_phrases'} close={close} done={done} />),

    status: (date: string, zone: Zone | null, current: { status: DayStatus | 'field'; memo: string }, staff: boolean) =>
      ask<StatusResult | null>((close, done) => <StatusSheet date={date} zone={zone} current={current} staff={staff} close={close} done={done} />),

    /** 그날 그 지역 차량 — 공차·상차 없는 차량 먼저, 수리 차량은 경고, 현장근무 지급 차량 제외 */
    /** withExternal: 맨 위에 "용차로 · 화주 배차로 · 날짜 변경" (값 EXTERNAL_HIRED / EXTERNAL_SHIPPER / MOVE_DATE) */
    vehicle: (board: Board, zone: Zone | null, withExternal = false) =>
      ask<string | null>((close, done) => {
        const s = snap();
        const choices = vehicleChoices(board, zone);
        const item = (c: (typeof choices)[number]) => ({
          id: c.row.vehicle.id,
          label: `${c.row.vehicle.short_no}  ${c.row.vehicle.vehicle_type}`,
          sub: [c.row.zone ? ZONE_LABEL[c.row.zone] : '위치 미정', c.free ? '상차 없음' : `상차 ${c.row.loads.length}`, s.drivers.find((d) => d.id === c.row.driverId)?.name].filter(Boolean).join(' · '),
          warn: c.warn || undefined,
          faded: !c.sameZone,
        });
        return (
          <Sheet title="차량 선택" onClose={() => { done(null); close(); }} flush>
            <PickerList
              sections={[
                { label: zone ? `${ZONE_LABEL[zone]}에 있는 차량` : '차량', items: choices.filter((c) => c.sameZone).map(item) },
                { label: '다른 지역', items: choices.filter((c) => !c.sameZone).map(item) },
              ]}
              onPick={(it) => { done(it.id); close(); }}
              top={withExternal ? (
                <div className="row" style={{ padding: '8px 12px' }}>
                  <button className="grow" onClick={() => { done(EXTERNAL_HIRED); close(); }}>🚚 용차로</button>
                  <button className="grow" onClick={() => { done(EXTERNAL_SHIPPER); close(); }}>🏭 화주 배차로</button>
                  <button className="grow" onClick={() => { done(MOVE_DATE); close(); }}>📅 날짜 변경</button>
                </div>
              ) : undefined}
            />
          </Sheet>
        );
      }),

    /** 팀별로 묶은 기사 목록: 오늘 근무 → 알바 → 근무일 아님(흐리게). 휴무 지정자는 제외 */
    driver: (date: string, current: string | null) =>
      ask<string | null | undefined>((close, done) => <DriverSheet date={date} current={current} close={close} done={done} />),

    workType: (date: string, driverId: string) =>
      ask<void>((close, done) => <WorkTypeSheet date={date} driverId={driverId} close={() => { done(); close(); }} />),

    /** 현장근무용 직원 (휴무자 제외) */
    staff: (date: string) =>
      ask<string | null>((close, done) => {
        const s = snap();
        const offIds = new Set(s.field_assignments.filter((f) => f.date === date && f.is_off).map((f) => f.staff_id));
        return (
          <Sheet title="직원 선택" onClose={() => { done(null); close(); }} flush>
            <PickerList
              sections={[{ label: '직원', items: s.drivers.filter((d) => !offIds.has(d.id)).map((d) => ({ id: d.id, label: d.name, sub: [d.staff_type, d.affiliation].join(' · ') })) }]}
              onPick={(it) => { done(it.id); close(); }}
            />
          </Sheet>
        );
      }),

    site: () =>
      ask<string | null>((close, done) => (
        <Sheet title="근무지" onClose={() => { done(null); close(); }} flush>
          <PickerList sections={[{ label: '근무지', items: snap().field_sites.map((x) => ({ id: x.id, label: x.name })) }]} onPick={(it) => { done(it.id); close(); }} />
        </Sheet>
      )),

    /** 업무용 포함 전체 차량 (현장근무 지급용) */
    anyVehicle: () =>
      ask<string | null | undefined>((close, done) => (
        <Sheet title="지급 차량" onClose={() => { done(undefined); close(); }} flush>
          <PickerList
            sections={[{ label: '차량', items: snap().vehicles.map((v) => ({ id: v.id, label: `${v.short_no} ${v.vehicle_type}`, sub: `${v.usage} · ${v.plate}` })) }]}
            onPick={(it) => { done(it.id); close(); }}
            top={<div className="list-item" onClick={() => { done(null); close(); }}><span className="muted">차량 없음</span></div>}
          />
        </Sheet>
      )),

    date: (title: string, initial: string, min?: string) =>
      ask<string | null>((close, done) => <DateSheet title={title} initial={initial} min={min} close={close} done={done} />),
  };
}

const groupOrder = (a: string, b: string) => (a === '팀 없음' ? 1 : b === '팀 없음' ? -1 : a.localeCompare(b, 'ko', { numeric: true }));

function DriverSheet(p: { date: string; current: string | null; close: () => void; done: (v: string | null | undefined) => void }) {
  const s = snap();
  const [team, setTeam] = useState<string | null>(null);
  const finish = (v: string | null | undefined) => {
    p.done(v);
    p.close();
  };
  const offIds = new Set(s.field_assignments.filter((f) => f.date === p.date && f.is_off).map((f) => f.staff_id));
  const all = s.drivers.filter((d) => d.staff_type === '기사' && !offIds.has(d.id));
  const teams = [...new Set(all.map(driverGroup))].sort(groupOrder);
  const ds = all.filter((d) => !team || driverGroup(d) === team).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const working = ds.filter((d) => isDriverWorking(s, d, p.date));
  const onCall = ds.filter((d) => !working.includes(d) && d.shift === ON_CALL_SHIFT);
  const offDay = ds.filter((d) => !working.includes(d) && d.shift !== ON_CALL_SHIFT);
  const item = (d: (typeof ds)[number], faded = false) => ({ id: d.id, label: d.name, sub: [team ? '' : driverGroup(d), d.shift !== driverGroup(d) ? d.shift : '', d.memo].filter(Boolean).join(' · '), faded });
  const byTeam = (list: typeof ds, label: (t: string) => string, faded = false): PickSection[] =>
    [...new Set(list.map(driverGroup))].sort(groupOrder).map((t) => ({ label: label(t), items: list.filter((d) => driverGroup(d) === t).map((d) => item(d, faded)) }));
  return (
    <Sheet title="기사 선택" onClose={() => finish(undefined)} flush>
      {teams.length > 1 && (
        <div className="chips" style={{ padding: '8px 12px 0' }}>
          <button className={`chip${team === null ? ' on' : ''}`} onClick={() => setTeam(null)}>전체</button>
          {teams.map((t) => (
            <button key={t} className={`chip${team === t ? ' on' : ''}`} onClick={() => setTeam(t)}>
              {t} <span className="muted small">{all.filter((d) => driverGroup(d) === t && isDriverWorking(s, d, p.date)).length}</span>
            </button>
          ))}
        </div>
      )}
      <PickerList
        key={team ?? 'all'}
        sections={[
          ...byTeam(working, (t) => `오늘 근무 · ${t}`),
          ...(onCall.length ? [{ label: '알바 (원할 때 출근 · 고르면 근무형태 입력)', items: onCall.map((d) => item(d)) }] : []),
          ...byTeam(offDay, (t) => `근무일 아님 · ${t}`, true),
        ]}
        onPick={(it) => finish(it.id)}
        top={p.current ? <div className="list-item" onClick={() => finish(null)}><span style={{ color: 'var(--red)' }}>기사 비우기 (미지정)</span></div> : undefined}
      />
    </Sheet>
  );
}

function DateSheet(p: { title: string; initial: string; min?: string; close: () => void; done: (v: string | null) => void }) {
  const [v, setV] = useState(p.initial);
  return (
    <Sheet title={p.title} onClose={() => { p.done(null); p.close(); }} footer={<button className="primary" onClick={() => { p.done(v); p.close(); }}>확인</button>}>
      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => setV(addDays(v, -1))}>◀</button>
        <input type="date" value={v} min={p.min} onChange={(e) => setV(e.target.value)} />
        <button onClick={() => setV(addDays(v, 1))}>▶</button>
      </div>
    </Sheet>
  );
}
