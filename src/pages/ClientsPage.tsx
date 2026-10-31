import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { matchSearch, newId, won, type Client, type Product } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { fmtDate } from '../lib/time.ts';
import { Editable } from '../ui/Editable.tsx';
import { ManageTabs, useManageSwipe } from '../ui/ManageTabs.tsx';
import { useRole, useSnap, useWatch } from '../ui/hooks.ts';
import { ZONE_LABEL, kindLabel, orderText, vehicleNo } from '../ui/labels.ts';
import { StorageBadge, tempText } from '../ui/OrderSheet.tsx';
import { RecurringList, RecurringSheet } from '../ui/RecurringSheet.tsx';
import { QtyInput } from '../ui/QtyInput.tsx';
import { RecentChanges } from '../ui/RecentChanges.tsx';
import { Sheet, useSheet } from '../ui/Sheet.tsx';
import { History } from './ProductDetailPage.tsx';

export function newProduct(clientId: string, name: string): Product {
  return {
    id: newId(), client_id: clientId, name, default_region: '', default_quantity: null, default_unit: '',
    pickup_address: '', pickup_lat: null, pickup_lng: null, pickup_note: '', dropoff_address: '', dropoff_lat: null,
    dropoff_lng: null, dropoff_note: '', pickup_contact_name: '', pickup_contact_phone: '', dropoff_contact_name: '',
    dropoff_contact_phone: '', storage: 'ambient', temp_min: null, temp_max: null, caution: '',
  };
}

/** 품목 등록: 이름 + 기본 수량·단위 (예: 1대) 를 한 번에 */
function NewProductSheet({ clientId, close, onSaved }: { clientId: string; close: () => void; onSaved: (id: string) => void }) {
  const [p, setP] = useState(() => newProduct(clientId, ''));
  const save = () => {
    if (!p.name.trim()) return store.toast('품목 이름을 입력하세요', 'warn');
    store.run((tx) => tx.insert('products', { ...p, name: p.name.trim() }));
    close();
    onSaved(p.id);
  };
  return (
    <Sheet title="품목 등록" onClose={close} footer={<button className="primary" onClick={save}>저장</button>}>
      <label className="field"><span>품목 이름</span><input autoFocus value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="예: 산지 감귤" /></label>
      <div className="field">
        <span>기본 수량·단위 <span className="muted small">(배차할 때 바로 들어감)</span></span>
        <QtyInput big quantity={p.default_quantity} unit={p.default_unit} onChange={(q, u) => setP({ ...p, default_quantity: q, default_unit: u })} />
      </div>
      <label className="field"><span>기본 지역</span><input value={p.default_region} onChange={(e) => setP({ ...p, default_region: e.target.value })} placeholder="예: 서귀포" /></label>
      <p className="muted small">주소·연락처·보관 온도 등은 저장 후 품목 화면에서 넣으세요.</p>
    </Sheet>
  );
}

export function ClientsPage() {
  const snap = useSnap();
  const nav = useNavigate();
  const { staff, admin } = useRole();
  const [q, setQ] = useState('');
  const list = useMemo(
    () => [...snap.clients].filter((c) => matchSearch(c.name + ' ' + c.manager, q)).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [snap.clients, q],
  );
  const add = () => {
    const name = prompt('새 거래처 이름')?.trim();
    if (!name) return;
    const id = newId();
    store.run((tx) => tx.insert('clients', { id, name, manager: '', phone: '', default_ship: null, memo: '' }));
    nav(`/clients/${id}`);
  };
  const swipe = useManageSwipe();
  return (
    <div className="page" style={{ minHeight: '80vh' }} {...swipe}>
      <ManageTabs />
      <div className="row"><h2 className="grow">거래처</h2>
        {!admin && <button onClick={() => nav('/settings')}>👤 내 계정</button>}
        {staff && <button className="primary" onClick={add}>＋ 새 거래처</button>}</div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색 (초성 가능)" />
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {list.map((c) => {
          const ps = snap.products.filter((p) => p.client_id === c.id);
          const recs = snap.recurring_orders.filter((r) => r.client_id === c.id && r.active).length;
          return (
            <div key={c.id} className="list-item" onClick={() => nav(`/clients/${c.id}`)}>
              <div className="grow">
                <div style={{ fontWeight: 700 }}>{c.name}</div>
                <div className="muted">품목 {ps.length} {recs ? `· 반복 ${recs}` : ''} {c.manager && `· ${c.manager}`}</div>
              </div>
              <span className="muted">›</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ClientDetailPage() {
  const { id } = useParams();
  const snap = useSnap();
  const nav = useNavigate();
  const sheet = useSheet();
  const { staff } = useRole();
  const [tab, setTab] = useState<'products' | 'recurring' | 'history'>('products');
  const c = snap.clients.find((x) => x.id === id);
  useWatch(id);
  if (!c) return <div className="page"><p>거래처를 찾을 수 없습니다.</p></div>;
  const save = (k: keyof Client) => (staff ? (v: string) => { store.expectOnly(c); store.run((tx) => tx.update('clients', c.id, { [k]: v || (k === 'default_ship' ? null : '') })); } : undefined);
  const products = snap.products.filter((p) => p.client_id === c.id);
  const recent = snap.daily_orders.filter((o) => o.client_id === c.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);

  const addProduct = () => sheet.open((close) => <NewProductSheet clientId={c.id} close={close} onSaved={(id) => nav(`/products/${id}`)} />);

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="row"><button className="ghost" onClick={() => nav('/clients')}>◀</button><h2 className="grow">{c.name}</h2></div>
      <RecentChanges ids={[c.id]} />
      <div className="card">
        <Editable label="거래처명" value={c.name} onSave={save('name')} />
        <Editable label="담당자" value={c.manager} onSave={save('manager')} />
        <Editable label="연락처" value={c.phone} onSave={save('phone')} type="tel" />
        <Editable label="기본 선박" value={c.default_ship} onSave={save('default_ship')} options={[{ value: '', label: '-' }, ...[...new Set(snap.ships.map((s) => s.name))].map((n) => ({ value: n, label: n }))]} />
        <Editable label="메모" value={c.memo} onSave={save('memo')} multiline />
        <details>
          <summary className="muted" style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>기본 주소·연락처 (품목에서 다르면 덮어쓰기)</summary>
          <Editable label="상차지" value={c.pickup_address ?? ''} onSave={save('pickup_address')} />
          <Editable label="상차 담당" value={c.pickup_contact_name ?? ''} onSave={save('pickup_contact_name')} />
          <Editable label="상차 전화" value={c.pickup_contact_phone ?? ''} onSave={save('pickup_contact_phone')} type="tel" />
          <Editable label="하차지" value={c.dropoff_address ?? ''} onSave={save('dropoff_address')} />
          <Editable label="하차 담당" value={c.dropoff_contact_name ?? ''} onSave={save('dropoff_contact_name')} />
          <Editable label="하차 전화" value={c.dropoff_contact_phone ?? ''} onSave={save('dropoff_contact_phone')} type="tel" />
        </details>
      </div>
      <div className="tabs">
        <button className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>품목 {products.length}</button>
        <button className={tab === 'recurring' ? 'on' : ''} onClick={() => setTab('recurring')}>반복 발주</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>이력</button>
      </div>
      {tab === 'products' && (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {products.map((p) => {
              const pr = snap.product_pricing.find((x) => x.product_id === p.id);
              return (
                <div key={p.id} className="list-item" onClick={() => nav(`/products/${p.id}`)}>
                  <div className="grow">
                    <div style={{ fontWeight: 700 }}>{p.name} <StorageBadge storage={p.storage} temp={tempText(p)} /></div>
                    <div className="muted">{[p.default_region, p.default_quantity != null ? `${p.default_quantity}${p.default_unit}` : '', staff && pr ? won(pr.unit_price) : ''].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span className="muted">›</span>
                </div>
              );
            })}
            {!products.length && <p className="muted" style={{ padding: 12 }}>등록된 품목 없음</p>}
          </div>
          {staff && <button style={{ width: '100%' }} onClick={addProduct}>＋ 품목 등록</button>}
        </>
      )}
      {tab === 'recurring' && (
        <>
          {staff && products.length > 0 && (
            <button style={{ width: '100%' }} onClick={async () => {
              const pid = products.length === 1 ? products[0].id : await new Promise<string | null>((res) => {
                const n = prompt(`품목 번호를 고르세요\n${products.map((p, i) => `${i + 1}. ${p.name}`).join('\n')}`);
                res(n ? products[Number(n) - 1]?.id ?? null : null);
              });
              if (pid) sheet.open((close) => <RecurringSheet close={close} mode="create" clientId={c.id} productId={pid} />);
            }}>＋ 반복 발주 등록</button>
          )}
          <RecurringList clientId={c.id} open={(mode, rec) => sheet.open((close) => <RecurringSheet close={close} mode={mode} recurring={rec} clientId={c.id} productId={rec?.product_id ?? null} />)} />
        </>
      )}
      {tab === 'history' && (
        <>
          <div className="card">
            <h3>최근 오더</h3>
            {recent.map((o) => (
              <div key={o.id} className="list-item" onClick={() => nav(`/?date=${o.date}&zone=${o.zone}&focus=${o.id}`)}>
                <span style={{ width: 92 }}>{fmtDate(o.date)}</span>
                <span style={{ width: 70 }}>{ZONE_LABEL[o.zone]} {kindLabel(o.zone, o.kind)}</span>
                <span className="grow">{orderText(snap, o)}</span>
                <span className="muted">{vehicleNo(snap, o.vehicle_id)}</span>
              </div>
            ))}
            {!recent.length && <p className="muted">없음</p>}
          </div>
          {staff && <History table="clients" id={c.id} />}
        </>
      )}
      {staff && <button className="danger" style={{ width: '100%', marginTop: 16 }} onClick={() => { if (confirm(`${c.name} 거래처와 품목을 삭제할까요?`)) { store.run((tx) => { for (const p of products) tx.remove('products', p.id); tx.remove('clients', c.id); }); nav('/clients'); } }}>거래처 삭제</button>}
    </div>
  );
}
