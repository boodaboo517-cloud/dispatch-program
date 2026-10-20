// 매일 새벽 스케줄러 (pg_cron → 이 함수)
//  task=extend : 반복 발주·고정 근무를 오늘+8주까지 연장 (+연결 하차 연쇄), 정비 알림, 월말 금액 미입력 알림
//  task=alerts : 출항 당일 오후 배차 대기 상차 알림
// 도메인 로직은 앱과 같은 코드를 쓴다 (npm run sync:functions 로 src/domain → _shared/domain 복사)
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  addDays, emptySnapshot, maintenanceAlerts, planFieldExtension, planRecurringExtension, toBatches,
  type Snapshot, type TableName,
} from '../_shared/domain/index.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

async function fetchAll(table: TableName, filter?: (q: any) => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select('*').range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function load(today: string): Promise<Snapshot> {
  const since = addDays(today, -7);
  const s = emptySnapshot() as any;
  const full: TableName[] = [
    'recurring_orders', 'recurring_order_versions', 'products', 'product_pricing', 'ships', 'vehicles', 'drivers',
    'recurring_field_work', 'recurring_field_versions', 'field_sites', 'maintenance_records',
    'maintenance_schedules', 'odometer_logs', 'settings', 'clients',
  ];
  for (const t of full) s[t] = await fetchAll(t);
  s.daily_orders = await fetchAll('daily_orders', (q) => q.gte('date', since));
  s.vehicle_days = await fetchAll('vehicle_days', (q) => q.gte('date', since));
  s.field_assignments = await fetchAll('field_assignments', (q) => q.gte('date', since));
  for (const o of s.daily_orders) o.quantity = o.quantity === null ? null : Number(o.quantity);
  return s;
}

async function apply(muts: Parameters<typeof toBatches>[0]) {
  for (const b of toBatches(muts)) {
    const { error } = b.op === 'upsert'
      ? await supabase.from(b.table).upsert(b.rows)
      : await supabase.from(b.table).delete().in('id', b.ids);
    if (error) throw new Error(`${b.table} ${b.op}: ${error.message}`);
  }
}

async function notice(date: string, message: string, vehicle_id: string | null = null) {
  await supabase.from('notices').insert({ date, message, vehicle_id, driver_id: null });
}

Deno.serve(async (req) => {
  const { task = 'extend' } = await req.json().catch(() => ({}));
  const today = seoulToday();
  try {
    if (task === 'extend') {
      const snap = await load(today);
      const a = planRecurringExtension(snap, today);
      const b = planFieldExtension(a.snapshot, today);
      await apply([...a.mutations, ...b.mutations]);
      for (const al of maintenanceAlerts(b.snapshot, today)) await notice(today, `[정비] ${al.message}`, al.vehicle_id);
      // 월말: 금액 미입력 오더 알림
      if (addDays(today, 1).slice(8) === '01') {
        const month = today.slice(0, 7);
        const { data: orders } = await supabase.from('daily_orders').select('id').gte('date', `${month}-01`).lte('date', today).neq('source', 'linked');
        const { data: revs } = await supabase.from('order_revenue').select('order_id,total').not('total', 'is', null);
        const priced = new Set((revs ?? []).map((r) => r.order_id));
        const missing = (orders ?? []).filter((o) => !priced.has(o.id)).length;
        if (missing) await notice(today, `[매출] ${month} 금액 미입력 오더 ${missing}건`);
      }
      return Response.json({ ok: true, today, orders: a.created, field: b.created });
    }
    if (task === 'alerts') {
      const { data } = await supabase.from('daily_orders').select('id').eq('date', today).is('vehicle_id', null).eq('kind', 'load');
      if (data?.length) await notice(today, `[배차] 오늘 배차 대기 상차 ${data.length}건이 남아 있습니다`);
      return Response.json({ ok: true, waiting: data?.length ?? 0 });
    }
    return Response.json({ ok: false, error: 'unknown task' }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
