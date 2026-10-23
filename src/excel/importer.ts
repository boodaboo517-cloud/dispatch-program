// 엑셀 업로드 (거래처·품목 / 차량·기사 / 오더 일괄) — 미리보기 후 반영, 오류 행 표시
import type { Worksheet } from 'exceljs';
import {
  SHIFT_PRESETS, Tx, blankOrder, createOrder, newId, splitPerVehicle,
  type CalcMethod, type Kind, type ShipTag, type Snapshot, type Storage, type Unit, type VehicleType, type Weekday, type Zone,
} from '../domain/index.ts';
import { download, header, newWorkbook } from './common.ts';

export const TEMPLATES: Record<string, string[]> = {
  거래처: ['거래처명*', '담당자', '연락처', '기본선박', '메모'],
  품목: ['거래처명*', '품목명*', '기본지역', '기본수량', '단위(대/파렛트/m/박스)', '보관(상온/냉장/냉동)', '상차지주소', '하차지주소', '주의사항', '계산방식(파렛트당/대당/금액직접)', '기본단가'],
  차량: ['차량번호*', '뒤4자리', '차종*(5톤/통윙/통윙2냉/1톤/승용)', '구분(배차/업무용)', '소속(자차/개인)', '상태(운행/정비/휴차)', '현재위치(육지/제주)'],
  기사: ['이름*', '연락처', '근무요일(예: 월수금)', '근무조(월수금/화목일/월수/토요일/주말/알바/부산상주/서울상주)', '소속', '직원구분(기사/현장/사무)', '비고', '팀'],
  오더: ['날짜*(YYYY-MM-DD)', '구역*(육지/제주)', '구분*(하차/상차/오전/오후)', '거래처', '품목', '지역', '수량', '단위', '비고', '차량(뒤4자리)', '기사', '선박', '선박표시(아침/예약/야간)'],
};

const EXAMPLES: Record<string, (string | number)[]> = {
  거래처: ['도민물류', '홍길동', '010-0000-0000', '제이엘', ''],
  품목: ['도민물류', '감귤', '서귀포', 10, '파렛트', '상온', '', '', '', '파렛트당', 90000],
  차량: ['제주90바9915', '9915', '통윙', '배차', '자차', '운행', '육지'],
  기사: ['김기사', '010-0000-0000', '월수금', '월수금', '경민물류', '기사', '대형면허', '1팀'],
  오더: ['2026-10-21', '육지', '상차', '도민물류', '감귤', '서귀포', 10, '파렛트', '', '9915', '', '제이엘', ''],
};

export async function downloadTemplates() {
  const wb = await newWorkbook();
  for (const [name, cols] of Object.entries(TEMPLATES)) {
    const ws = wb.addWorksheet(name);
    header(ws, 1, cols);
    ws.getRow(2).values = EXAMPLES[name];
    ws.getRow(2).font = { color: { argb: 'FF9CA3AF' }, italic: true };
    ws.columns = cols.map((c) => ({ width: Math.max(12, c.length + 4) }));
  }
  await download(wb, '경민물류 업로드 양식.xlsx');
}

export interface PreviewRow {
  sheet: string;
  line: number;
  values: string[];
  errors: string[];
  action: '추가' | '수정' | '';
}

const str = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: string }).text);
  if (typeof v === 'object' && 'result' in (v as object)) return String((v as { result: unknown }).result ?? '');
  return String(v).trim();
};
const num = (v: string) => (v === '' ? null : Number(v.replace(/,/g, '')));
const WD: Record<string, Weekday> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const STORAGE: Record<string, Storage> = { 상온: 'ambient', 냉장: 'chilled', 냉동: 'frozen' };
const CALC: Record<string, CalcMethod> = { 파렛트당: 'per_pallet', 대당: 'per_unit', 금액직접: 'fixed', '금액 직접': 'fixed' };
const UNITS = ['대', '파렛트', 'm', '박스', ''];
const TYPES = ['5톤', '통윙', '통윙2냉', '1톤', '승용'];

function rowsOf(ws: Worksheet): { line: number; v: string[] }[] {
  const out: { line: number; v: string[] }[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const v: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) v.push(str(row.getCell(c).value));
    if (v.some((x) => x !== '')) out.push({ line: n, v });
  });
  return out;
}

export async function parseUpload(file: File): Promise<Record<string, { line: number; v: string[] }[]>> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const out: Record<string, { line: number; v: string[] }[]> = {};
  wb.eachSheet((ws) => {
    const name = Object.keys(TEMPLATES).find((k) => ws.name.includes(k));
    if (name) out[name] = rowsOf(ws);
  });
  return out;
}

/**
 * 업로드 내용을 검증하고(미리보기), apply=true 면 Tx 에 반영한다.
 * 이름이 같은 거래처·품목·차량·기사는 수정, 없으면 추가. 오더는 항상 추가(상차면 연결 하차도 생성).
 */
export function planUpload(snap: Snapshot, data: Record<string, { line: number; v: string[] }[]>, tx?: Tx): PreviewRow[] {
  const preview: PreviewRow[] = [];
  const t = tx ?? new Tx(snap);
  const findClient = (name: string) => t.list('clients').find((c) => c.name === name);
  const findDriver = (name: string) => t.list('drivers').find((d) => d.name === name);

  for (const { line, v } of data['거래처'] ?? []) {
    const [name, manager, phone, ship, memo] = v;
    const errors = name ? [] : ['거래처명 없음'];
    const cur = findClient(name);
    preview.push({ sheet: '거래처', line, values: v, errors, action: errors.length ? '' : cur ? '수정' : '추가' });
    if (errors.length) continue;
    const row = { name, manager, phone, default_ship: ship || null, memo };
    if (cur) t.update('clients', cur.id, row);
    else t.insert('clients', { id: newId(), ...row });
  }

  for (const { line, v } of data['기사'] ?? []) {
    const [name, phone, days, shift, aff, type, memo, team] = v;
    const errors: string[] = [];
    if (!name) errors.push('이름 없음');
    if (type && !['기사', '현장', '사무'].includes(type)) errors.push('직원구분 오류');
    const cur = findDriver(name);
    preview.push({ sheet: '기사', line, values: v, errors, action: errors.length ? '' : cur ? '수정' : '추가' });
    if (errors.length) continue;
    const typed = [...days].map((c) => WD[c]).filter((x) => x !== undefined) as Weekday[];
    const row = {
      name, phone, shift, affiliation: aff, memo: memo ?? '', team: team ?? '',
      // 근무요일을 비우면 근무조 기본 요일 (알바는 정해진 요일 없음)
      work_days: typed.length ? typed : SHIFT_PRESETS[shift] ?? [],
      staff_type: (type || '기사') as '기사' | '현장' | '사무',
    };
    if (cur) t.update('drivers', cur.id, row);
    else t.insert('drivers', { id: newId(), ...row });
  }

  for (const { line, v } of data['품목'] ?? []) {
    const [cname, pname, region, qty, unit, storage, pick, drop, caution, calc, price] = v;
    const errors: string[] = [];
    const client = findClient(cname);
    if (!client) errors.push(`거래처 "${cname}" 없음`);
    if (!pname) errors.push('품목명 없음');
    if (unit && !UNITS.includes(unit)) errors.push('단위 오류');
    if (storage && !STORAGE[storage]) errors.push('보관 구분 오류');
    if (qty && Number.isNaN(Number(qty))) errors.push('수량 숫자 아님');
    if (calc && !CALC[calc]) errors.push('계산방식 오류');
    if (price && Number.isNaN(Number(price.replace(/,/g, '')))) errors.push('단가 숫자 아님');
    const cur = client && t.list('products').find((p) => p.client_id === client.id && p.name === pname);
    preview.push({ sheet: '품목', line, values: v, errors, action: errors.length ? '' : cur ? '수정' : '추가' });
    if (errors.length || !client) continue;
    const row = {
      client_id: client.id, name: pname, default_region: region, default_quantity: num(qty), default_unit: (unit || '') as Unit,
      storage: STORAGE[storage] ?? 'ambient', pickup_address: pick, dropoff_address: drop, caution,
    };
    let pid: string;
    if (cur) {
      t.update('products', cur.id, row);
      pid = cur.id;
    } else {
      pid = newId();
      t.insert('products', {
        id: pid, ...row, pickup_lat: null, pickup_lng: null, pickup_note: '', dropoff_lat: null, dropoff_lng: null, dropoff_note: '',
        pickup_contact_name: '', pickup_contact_phone: '', dropoff_contact_name: '', dropoff_contact_phone: '', temp_min: null, temp_max: null,
      });
    }
    if (price) {
      const pp = t.list('product_pricing').find((x) => x.product_id === pid);
      const pr = { product_id: pid, calc_method: CALC[calc] ?? 'per_pallet', unit_price: num(price)! };
      if (pp) t.update('product_pricing', pp.id, pr);
      else t.insert('product_pricing', { id: newId(), ...pr });
    }
  }

  for (const { line, v } of data['차량'] ?? []) {
    const [plate, short, type, usage, own, status, zone] = v;
    const errors: string[] = [];
    if (!plate) errors.push('차량번호 없음');
    if (!TYPES.includes(type)) errors.push('차종 오류');
    if (zone && !['육지', '제주'].includes(zone)) errors.push('위치 오류');
    const cur = t.list('vehicles').find((x) => x.plate === plate);
    preview.push({ sheet: '차량', line, values: v, errors, action: errors.length ? '' : cur ? '수정' : '추가' });
    if (errors.length) continue;
    const row = {
      plate, short_no: short || plate.replace(/\D/g, '').slice(-4), vehicle_type: type as VehicleType,
      usage: (usage === '업무용' ? '업무용' : '배차') as '배차' | '업무용', ownership: (own === '개인' ? '개인' : '자차') as '자차' | '개인',
      status: (['운행', '정비', '휴차'].includes(status) ? status : '운행') as '운행',
      home_zone: (zone === '제주' ? 'jeju' : zone === '육지' ? 'land' : null) as Zone | null,
    };
    if (cur) t.update('vehicles', cur.id, row);
    else t.insert('vehicles', { id: newId(), ...row, default_driver_id: null, sort_order: t.list('vehicles').length, oil_interval_km: null });
  }

  for (const { line, v } of data['오더'] ?? []) {
    const [date, zoneS, kindS, cname, pname, region, qty, unit, memo, veh, drv, ship, tag] = v;
    const errors: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('날짜 형식 오류');
    const zone: Zone | null = zoneS === '육지' ? 'land' : zoneS === '제주' ? 'jeju' : null;
    if (!zone) errors.push('구역 오류');
    const kind: Kind | null = ['하차', '오전'].includes(kindS) ? 'unload' : ['상차', '오후'].includes(kindS) ? 'load' : null;
    if (!kind) errors.push('구분 오류');
    const client = cname ? findClient(cname) : undefined;
    const product = client && pname ? t.list('products').find((p) => p.client_id === client.id && p.name === pname) : undefined;
    const vehicle = veh ? t.list('vehicles').find((x) => x.short_no === veh || x.plate === veh) : undefined;
    if (veh && !vehicle) errors.push(`차량 "${veh}" 없음`);
    if (drv && !findDriver(drv)) errors.push(`기사 "${drv}" 없음`);
    if (qty && Number.isNaN(Number(qty))) errors.push('수량 숫자 아님');
    if (unit && !UNITS.includes(unit)) errors.push('단위 오류');
    if (tag && !['아침', '예약', '야간'].includes(tag)) errors.push('선박표시 오류');
    preview.push({ sheet: '오더', line, values: v, errors, action: errors.length ? '' : '추가' });
    if (errors.length || !zone || !kind) continue;
    const shipFields = kind === 'load'
      ? { departure_ship: ship || null, departure_ship_tag: (tag || '') as ShipTag }
      : { arrival_ship: ship || null, arrival_ship_tag: (tag || '') as ShipTag };
    const created = createOrder(t, blankOrder({
      date, zone, kind, client_id: client?.id ?? null, client_text: client ? '' : cname,
      product_id: product?.id ?? null, product_text: product ? '' : pname,
      region: region || product?.default_region || '', quantity: num(qty) ?? product?.default_quantity ?? null,
      unit: (unit || product?.default_unit || '') as Unit, memo,
      vehicle_id: vehicle?.id ?? null, driver_id: findDriver(drv)?.id ?? null, ...shipFields,
    }));
    splitPerVehicle(t, created.id); // "3대" → 1대씩 따로 배차
  }
  return preview;
}
