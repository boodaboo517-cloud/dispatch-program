// 품목 상세 (기사님 확인용 정보) — 관리자·배차는 간편수정, 기사는 보기 + 길찾기 + 전화
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CALC_LABEL, newId, setBulkFee, setProductDefaultPrice,
  type CalcMethod, type Product, type ProductSuggestion, type Storage, } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { supabase } from '../data/supabase.ts';
import { fmtStamp } from '../lib/time.ts';
import { Editable } from '../ui/Editable.tsx';
import { useRole, useSession, useSnap, useWatch } from '../ui/hooks.ts';
import { STORAGE_LABEL, setting } from '../ui/labels.ts';
import { CallButton, NavButtons, Photo, compressAndUpload, currentLocation, geocode, searchAddress } from '../ui/media.tsx';
import { StorageBadge, tempText } from '../ui/OrderSheet.tsx';
import { RecurringList, RecurringSheet } from '../ui/RecurringSheet.tsx';
import { Sheet, useSheet } from '../ui/Sheet.tsx';
import { QtyInput } from '../ui/QtyInput.tsx';

export function ProductDetailPage() {
  const { id } = useParams();
  const snap = useSnap();
  const session = useSession();
  const { staff } = useRole();
  const nav = useNavigate();
  const sheet = useSheet();
  useWatch(id);
  const [bulkCalc, setBulkCalc] = useState<CalcMethod>('per_pallet');
  const p = snap.products.find((x) => x.id === id);
  if (!p) return <div className="page"><p>품목을 찾을 수 없습니다.</p><button onClick={() => nav(-1)}>뒤로</button></div>;
  const client = snap.clients.find((c) => c.id === p.client_id);
  const photos = snap.product_photos.filter((x) => x.product_id === p.id);
  const pricing = snap.product_pricing.find((x) => x.product_id === p.id);
  const bulk = (snap.product_bulk_fees ?? []).find((x) => x.product_id === p.id);
  const allowSuggest = setting(snap, 'driver_suggestions', false);
  const edit = staff;
  const save = (patch: Partial<Product>) => {
    store.expectOnly(p);
    store.run((tx) => tx.update('products', p.id, patch));
  };
  const saver = (k: keyof Product, kind: 'text' | 'number' = 'text') =>
    edit ? (v: string) => save({ [k]: kind === 'number' ? (v === '' ? null : Number(v)) : v } as Partial<Product>) : undefined;

  const setAddress = async (which: 'pickup' | 'dropoff', how: 'search' | 'here') => {
    try {
      if (how === 'search') {
        const a = await searchAddress();
        if (!a) return;
        const c = await geocode(a).catch(() => null);
        save({ [`${which}_address`]: a, [`${which}_lat`]: c?.lat ?? null, [`${which}_lng`]: c?.lng ?? null } as Partial<Product>);
      } else {
        const l = await currentLocation();
        save({ [`${which}_address`]: l.address, [`${which}_lat`]: l.lat, [`${which}_lng`]: l.lng } as Partial<Product>);
      }
    } catch (e) {
      store.toast(e instanceof Error ? e.message : '위치를 가져오지 못했습니다', 'error');
    }
  };

  const addPhoto = async (files: FileList | null, suggest = false) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      try {
        const path = await compressAndUpload(f, suggest ? `suggestions/${p.id}` : `products/${p.id}`);
        if (suggest) {
          store.run((tx) => tx.insert('product_suggestions', { id: newId(), product_id: p.id, kind: 'photo', payload: path, status: 'pending', created_by: session?.userId ?? null }));
        } else {
          store.run((tx) => tx.insert('product_photos', { id: newId(), product_id: p.id, path, caption: '' }));
        }
      } catch (e) {
        store.toast(`사진 저장 실패: ${e instanceof Error ? e.message : e}`, 'error');
      }
    }
    if (suggest) store.toast('사진을 제안했습니다 (관리자 승인 후 반영)');
  };

  const viewPhoto = (url: string) => sheet.open((close) => (
    <Sheet title="사진" onClose={close}><img src={url} style={{ width: '100%', borderRadius: 8 }} alt="" /></Sheet>
  ));

  const place = (which: 'pickup' | 'dropoff') => {
    const label = which === 'pickup' ? '상차지' : '하차지';
    const addr = p[`${which}_address`] || (which === 'pickup' ? client?.pickup_address : client?.dropoff_address) || '';
    const cname = p[`${which}_contact_name`] || (which === 'pickup' ? client?.pickup_contact_name : client?.dropoff_contact_name) || '';
    const cphone = p[`${which}_contact_phone`] || (which === 'pickup' ? client?.pickup_contact_phone : client?.dropoff_contact_phone) || '';
    return (
      <div className="card">
        <h3>{label}</h3>
        <Editable label="주소" value={p[`${which}_address`]} placeholder={addr ? `거래처 기본: ${addr}` : '주소 없음'} onSave={saver(`${which}_address`)} />
        {edit && (
          <div className="row wrap">
            <button onClick={() => setAddress(which, 'search')}>🔍 주소 검색</button>
            <button onClick={() => setAddress(which, 'here')}>📍 현재 위치로 주소 넣기</button>
          </div>
        )}
        <NavButtons name={`${client?.name ?? ''} ${label}`} address={addr} lat={p[`${which}_lat`]} lng={p[`${which}_lng`]} />
        <Editable label="현장 메모" value={p[`${which}_note`]} placeholder="예: 2번 도크 · 지게차 있음" onSave={saver(`${which}_note`)} multiline />
        <Editable label="담당자" value={p[`${which}_contact_name`]} placeholder={cname ? `거래처 기본: ${cname}` : ''} onSave={saver(`${which}_contact_name`)} />
        <Editable label="전화" value={p[`${which}_contact_phone`]} placeholder={cphone ? `거래처 기본: ${cphone}` : ''} onSave={saver(`${which}_contact_phone`)} type="tel" />
        <CallButton name={cname} phone={cphone} />
      </div>
    );
  };

  const pending = snap.product_suggestions.filter((x) => x.product_id === p.id && x.status === 'pending');
  const review = (sug: ProductSuggestion, ok: boolean) => store.run((tx) => {
    tx.update('product_suggestions', sug.id, { status: ok ? 'approved' : 'rejected' });
    if (!ok) return;
    if (sug.kind === 'photo') tx.insert('product_photos', { id: newId(), product_id: p.id, path: sug.payload, caption: '기사 제안' });
    else tx.update('products', p.id, { caution: [p.caution, sug.payload].filter(Boolean).join('\n') });
  });

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="row">
        <button className="ghost" onClick={() => nav(-1)}>◀</button>
        <h2 className="grow">{client?.name} · {p.name}</h2>
        <StorageBadge storage={p.storage} temp={tempText(p)} />
      </div>
      {p.storage !== 'ambient' && <div className={`temp-band ${p.storage}`}>{STORAGE_LABEL[p.storage]} 화물 {tempText(p) && `· ${tempText(p)} 유지`}</div>}
      <div className="muted small">마지막 수정 {fmtStamp(p.updated_at)} {p.updated_by ? `· ${store.profileName(p.updated_by)}` : ''}</div>

      {p.caution && <div className="banner red" style={{ whiteSpace: 'pre-wrap' }}>⚠ 주의사항: {p.caution}</div>}

      <div className="card">
        <Editable label="품목명" value={p.name} onSave={saver('name')} />
        <Editable label="기본 지역" value={p.default_region} onSave={saver('default_region')} />
        {edit ? (
          <div className="field">
            <span>기본 수량·단위 <span className="muted small">(예: 1대, 10파렛트 — 배차할 때 바로 들어감)</span></span>
            <QtyInput quantity={p.default_quantity} unit={p.default_unit} onChange={(q, u) => save({ default_quantity: q, default_unit: u })} />
          </div>
        ) : (
          <Editable label="기본 수량" value={p.default_quantity != null ? `${p.default_quantity}${p.default_unit}` : p.default_unit} />
        )}
        <Editable label="보관" value={p.storage} onSave={edit ? (v) => save({ storage: v as Storage }) : undefined} options={(['ambient', 'chilled', 'frozen'] as Storage[]).map((s) => ({ value: s, label: STORAGE_LABEL[s] }))} />
        {p.storage !== 'ambient' && (
          <div className="row">
            <div className="grow"><Editable label="최저 ℃" value={p.temp_min} onSave={saver('temp_min', 'number')} type="number" /></div>
            <div className="grow"><Editable label="최고 ℃" value={p.temp_max} onSave={saver('temp_max', 'number')} type="number" /></div>
          </div>
        )}
        <Editable label="주의사항" value={p.caution} onSave={saver('caution')} multiline />
      </div>

      {place('pickup')}
      {place('dropoff')}

      <div className="card">
        <div className="row"><h3 className="grow">사진 {photos.length}</h3>
          {edit && <label><button onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement).click()}>📷 추가</button><input hidden type="file" accept="image/*" multiple onChange={(e) => addPhoto(e.target.files)} /></label>}
        </div>
        <div className="photos">
          {photos.map((ph) => (
            <div key={ph.id} style={{ position: 'relative' }}>
              <Photo path={ph.path} onClick={viewPhoto} />
              {edit && <button className="ghost" style={{ position: 'absolute', top: 0, right: 0, background: '#fffa', minHeight: 32 }} onClick={() => confirm('사진을 삭제할까요?') && store.run((tx) => tx.remove('product_photos', ph.id))}>✕</button>}
            </div>
          ))}
        </div>
        {!edit && allowSuggest && (
          <div className="row wrap" style={{ marginTop: 8 }}>
            <label><button onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement).click()}>📷 사진 제안</button><input hidden type="file" accept="image/*" capture="environment" onChange={(e) => addPhoto(e.target.files, true)} /></label>
            <button onClick={() => {
              const t = prompt('주의사항 제안 (관리자 승인 후 반영)');
              if (t) store.run((tx) => tx.insert('product_suggestions', { id: newId(), product_id: p.id, kind: 'caution', payload: t, status: 'pending', created_by: session?.userId ?? null }));
            }}>✎ 주의사항 제안</button>
          </div>
        )}
      </div>

      {staff && pending.length > 0 && (
        <div className="card" style={{ background: '#fffbeb' }}>
          <h3>기사 제안 {pending.length}건</h3>
          {pending.map((s) => (
            <div key={s.id} className="row" style={{ margin: '6px 0' }}>
              <div className="grow">{s.kind === 'photo' ? <div style={{ width: 80 }} className="photos"><Photo path={s.payload} /></div> : s.payload}</div>
              <button className="primary" onClick={() => review(s, true)}>승인</button>
              <button onClick={() => review(s, false)}>거절</button>
            </div>
          ))}
        </div>
      )}

      {staff && (
        <div className="card">
          <h3>기본 단가</h3>
          <Editable label="계산 방식" value={pricing?.calc_method ?? 'per_pallet'} options={(Object.keys(CALC_LABEL) as CalcMethod[]).map((k) => ({ value: k, label: CALC_LABEL[k] }))}
            onSave={(v) => store.run((tx) => setProductDefaultPrice(tx, p.id, v as CalcMethod, pricing?.unit_price ?? 0))} />
          <Editable label="단가" value={pricing?.unit_price ?? null} type="number" placeholder="미입력"
            onSave={(v) => v !== '' && store.run((tx) => setProductDefaultPrice(tx, p.id, pricing?.calc_method ?? 'per_pallet', Number(v.replace(/,/g, ''))))} />
          <p className="muted small">새 오더(반복 발주 포함)에 자동 입력됩니다. 바꿔도 지난 오더 금액은 그대로입니다.</p>
        </div>
      )}

      {staff && (
        <div className="card">
          <h3>🚢 벌크 선적 요금</h3>
          <Editable label="계산 방식" value={bulk?.calc_method ?? bulkCalc} options={(Object.keys(CALC_LABEL) as CalcMethod[]).map((k) => ({ value: k, label: k === 'fixed' ? '건당 (금액 직접)' : CALC_LABEL[k] }))}
            onSave={(v) => { setBulkCalc(v as CalcMethod); if (bulk) store.run((tx) => setBulkFee(tx, p.id, v as CalcMethod, bulk.fee)); }} />
          <Editable label="요금 (원)" value={bulk?.fee ?? null} type="number" placeholder="미입력"
            onSave={(v) => store.run((tx) => setBulkFee(tx, p.id, bulk?.calc_method ?? bulkCalc, v === '' ? null : Number(v.replace(/,/g, ''))))} />
          <p className="muted small">이 품목을 벌크(화물만 선적)로 보낼 때 선박비입니다. 파렛트당·대당은 수량 × 요금, 건당은 한 번에 이 금액. 매출 › 선박비에 합산됩니다.</p>
        </div>
      )}

      {staff && (
        <div className="card">
          <div className="row"><h3 className="grow">매주 반복</h3>
            <button onClick={() => sheet.open((close) => <RecurringSheet close={close} mode="create" clientId={p.client_id} productId={p.id} />)}>＋ 매주 반복 켜기</button>
          </div>
          <RecurringList clientId={p.client_id} productId={p.id} open={(mode, rec) => sheet.open((close) => <RecurringSheet close={close} mode={mode} recurring={rec} clientId={p.client_id} productId={p.id} />)} />
        </div>
      )}
      {staff && <History table="products" id={p.id} />}
      {staff && <button className="danger" style={{ width: '100%' }} onClick={() => { if (confirm('품목을 삭제할까요?')) { store.run((tx) => tx.remove('products', p.id)); nav(-1); } }}>품목 삭제</button>}
    </div>
  );
}

/** 변경 이력 (audit_log) */
export function History({ table, id }: { table: string; id: string }) {
  const [rows, setRows] = useState<{ at: string; actor: string | null; op: string; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null }[] | null>(null);
  useEffect(() => {
    if (!supabase) return;
    supabase.from('audit_log').select('at,actor,op,old_row,new_row').eq('table_name', table).eq('row_id', id).order('at', { ascending: false }).limit(30)
      .then(({ data }) => setRows(data ?? []));
  }, [table, id]);
  const changed = (r: NonNullable<typeof rows>[number]) =>
    r.op === 'INSERT' ? '등록' : r.op === 'DELETE' ? '삭제' : Object.keys(r.new_row ?? {}).filter((k) => !['updated_at', 'updated_by'].includes(k) && JSON.stringify(r.new_row?.[k]) !== JSON.stringify(r.old_row?.[k])).map((k) => `${k}: ${r.old_row?.[k] ?? ''} → ${r.new_row?.[k] ?? ''}`).join(', ');
  return (
    <div className="card">
      <h3>변경 이력</h3>
      {!supabase && <p className="muted">데모 모드에서는 이력이 저장되지 않습니다.</p>}
      {rows?.map((r, i) => (
        <div key={i} className="small" style={{ borderBottom: '1px solid #eee', padding: '6px 0' }}>
          <b>{fmtStamp(r.at)}</b> {r.actor ? store.profileName(r.actor) : '시스템'} · {changed(r)}
        </div>
      ))}
      {rows && !rows.length && <p className="muted">이력 없음</p>}
    </div>
  );
}
