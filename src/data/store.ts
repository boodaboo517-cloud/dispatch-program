// 오프라인 우선 저장소: 화면은 메모리 Snapshot 을 보고, 변경은 즉시 로컬 반영 → IndexedDB 캐시 →
// outbox 에 쌓았다가 온라인이면 Supabase 로 전송. 다른 사람 변경은 Realtime 으로 받는다 (마지막 저장 우선).
import { del, get, set } from 'idb-keyval';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  TABLES, Tx, addDays, applyMutations, emptySnapshot, planFieldExtension, repairSnapshot, planRecurringExtension, toBatches,
  type Mutation, type Role, type Snapshot, type TableName,
} from '../domain/index.ts';
import { seoulToday } from '../lib/time.ts';
import { initialSnapshot, type DemoData } from './demo.ts';
import { supabase } from './supabase.ts';

export interface Session {
  userId: string;
  name: string;
  role: Role;
  driverId: string | null;
  demo: boolean;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'error';
}

export interface StoreState {
  snap: Snapshot;
  session: Session | null;
  ready: boolean;
  online: boolean;
  pending: number;
  toasts: Toast[];
  loadedFrom: string; // 이 날짜 이후 날짜별 데이터를 들고 있음
  /** 이 기기에 마지막으로 자동 저장된 시각 */
  savedAt: string | null;
}

const DATED: TableName[] = ['daily_orders', 'vehicle_days', 'field_assignments', 'notices'];
const LOOKBACK = 120;
const PAGE = 1000;

type Row = { id: string } & Record<string, unknown>;

class Store {
  state: StoreState = {
    snap: emptySnapshot(),
    session: null,
    ready: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pending: 0,
    toasts: [],
    loadedFrom: addDays(seoulToday(), -LOOKBACK),
    savedAt: null,
  };
  private listeners = new Set<() => void>();
  private outbox = new Map<string, Mutation>();
  private flushing = false;
  private channel: RealtimeChannel | null = null;
  private toastSeq = 0;
  /** 지금 편집 중인 행 — 다른 사람이 바꾸면 알림 */
  watched = new Set<string>();
  /** 수정자 표시용 사용자 이름 */
  profiles = new Map<string, string>();
  profileName(id: string | null | undefined) {
    if (!id) return '';
    if (id === this.state.session?.userId) return this.state.session.name;
    return this.profiles.get(id) ?? '';
  }
  /** 기사 화면 알림 핸들러 */
  onNotice: ((message: string) => void) | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;

  private setState(p: Partial<StoreState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    const t = { id: ++this.toastSeq, text, kind };
    this.setState({ toasts: [...this.state.toasts, t] });
    setTimeout(() => this.setState({ toasts: this.state.toasts.filter((x) => x.id !== t.id) }), kind === 'error' ? 6000 : 3500);
  }

  private cacheKey() {
    return `snap:${this.state.session?.demo ? 'demo' : this.state.session?.userId}`;
  }

  async start(session: Session) {
    this.setState({ session, ready: false });
    window.addEventListener('online', () => {
      this.setState({ online: true });
      void this.flush();
      void this.refresh();
    });
    window.addEventListener('offline', () => this.setState({ online: false }));

    const cached = await get<Snapshot>(this.cacheKey()).catch(() => undefined);
    const outbox = await get<Mutation[]>(`outbox:${session.userId}`).catch(() => undefined);
    for (const m of outbox ?? []) this.outbox.set(key(m), m);
    if (cached) this.setState({ snap: repairSnapshot(cached), ready: true, pending: this.outbox.size });

    if (session.demo) {
      if (!cached) this.setState({ snap: initialSnapshot(demoDataKind(), seoulToday()), ready: true });
      // 브라우저가 저장 공간 부족 시 데이터를 지우지 않도록 영구 저장 요청
      void navigator.storage?.persist?.().catch(() => undefined);
      void this.persist();
    } else {
      await this.refresh();
      this.subscribeRealtime();
      void this.flush();
    }
    this.setState({ ready: true });
    if (session.role !== 'viewer') this.extendRecurring();
  }

  async stop() {
    if (this.channel) await supabase?.removeChannel(this.channel);
    this.channel = null;
    this.setState({ session: null, snap: emptySnapshot(), ready: false });
  }

  async resetDemo(kind: DemoData) {
    await del('snap:demo');
    localStorage.setItem('demo-data', kind);
    this.outbox.clear();
    this.setState({ snap: initialSnapshot(kind, seoulToday()), pending: 0 });
    void this.persist();
  }

  /** 백업 파일 복원 (데모 모드: 이 기기 데이터를 통째로 바꾼다) */
  replaceSnapshot(snap: Snapshot) {
    this.outbox.clear();
    this.setState({ snap: repairSnapshot(snap), pending: 0 });
    void this.persist();
  }

  /** 앱이 열릴 때도 반복 발주를 오늘+8주까지 연장 (새벽 스케줄러가 멈췄을 때 대비) */
  private extendRecurring() {
    const today = seoulToday();
    const a = planRecurringExtension(this.state.snap, today, this.actor());
    const b = planFieldExtension(a.snapshot, today, this.actor());
    const muts = [...a.mutations, ...b.mutations];
    if (muts.length) this.commit(muts);
  }

  private actor() {
    const s = this.state.session;
    return s && !s.demo ? s.userId : null;
  }

  /** 도메인 함수를 트랜잭션으로 실행하고 결과를 반영 */
  run<T>(fn: (tx: Tx) => T): T {
    const tx = new Tx(this.state.snap, { actor: this.actor() });
    const out = fn(tx);
    this.commit(tx.mutations());
    return out;
  }

  commit(muts: Mutation[]) {
    if (!muts.length) return;
    if (this.state.session?.role === 'viewer') {
      const allowed = muts.filter((m) => m.table === 'odometer_logs' || m.table === 'product_suggestions');
      if (allowed.length !== muts.length) {
        this.toast('조회 계정은 수정할 수 없습니다', 'warn');
        return;
      }
    }
    this.setState({ snap: applyMutations(this.state.snap, muts) });
    if (!this.state.session?.demo) {
      for (const m of muts) this.outbox.set(key(m), m);
      this.setState({ pending: this.outbox.size });
      void this.flush();
    }
    void this.persist();
  }

  /**
   * 이 기기(IndexedDB)에 바로 저장. 저장 중에 또 바뀌면 끝난 뒤 한 번 더 저장한다.
   * (예전에는 0.3초 모아서 저장 → 그 사이 앱을 닫으면 마지막 변경이 사라질 수 있었음)
   */
  private writing: Promise<void> | null = null;
  private dirty = false;
  private persist(): Promise<void> {
    this.dirty = true;
    if (!this.writing) {
      this.writing = (async () => {
        while (this.dirty) {
          this.dirty = false;
          const ok = await set(this.cacheKey(), this.state.snap).then(() => true, () => false);
          if (ok) this.setState({ savedAt: new Date().toISOString() });
          else this.toast('이 기기에 저장하지 못했습니다 — 저장 공간을 확인하고 백업 파일을 저장해 두세요', 'error');
          if (this.state.session) await set(`outbox:${this.state.session.userId}`, [...this.outbox.values()]).catch(() => undefined);
        }
        this.writing = null;
      })();
    }
    return this.writing;
  }

  /** 저장이 끝날 때까지 기다린다 (화면 이동 전 등) */
  whenSaved(): Promise<void> {
    return this.writing ?? Promise.resolve();
  }

  async flush() {
    if (!supabase || this.flushing || !this.outbox.size || !navigator.onLine) return;
    this.flushing = true;
    try {
      const sending = new Map(this.outbox);
      for (const b of toBatches([...sending.values()])) {
        const { error } = b.op === 'upsert'
          ? await supabase.from(b.table).upsert(b.rows.map((r) => stripLocal(b.table, r)), { defaultToNull: false })
          : await supabase.from(b.table).delete().in('id', b.ids);
        if (error) {
          if (isNetworkError(error)) throw error;
          // 권한·제약 오류: 이 묶음은 버리고 서버 상태로 되돌린다
          this.toast(`저장 실패 (${b.table}): ${error.message}`, 'error');
          void this.refreshTable(b.table);
        }
        const done = b.op === 'upsert' ? b.rows.map((r) => `${b.table}:${r.id as string}`) : b.ids.map((id) => `${b.table}:${id}`);
        for (const k of done) if (this.outbox.get(k) === sending.get(k)) this.outbox.delete(k);
      }
    } catch {
      // 오프라인 — 연결되면 다시 보낸다
    } finally {
      this.flushing = false;
      this.setState({ pending: this.outbox.size });
      void this.persist();
      if (this.outbox.size && navigator.onLine) setTimeout(() => void this.flush(), 5000);
    }
  }

  private async fetchTable(t: TableName, since?: string): Promise<Row[] | null> {
    if (!supabase) return null;
    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from(t).select('*').range(from, from + PAGE - 1);
      if (since && DATED.includes(t)) q = q.gte('date', since);
      const { data, error } = await q;
      if (error) return isNetworkError(error) ? null : rows;
      rows.push(...(data as Row[]));
      if (data.length < PAGE) return rows;
    }
  }

  private async refreshTable(t: TableName) {
    const rows = await this.fetchTable(t, this.state.loadedFrom);
    if (!rows) return;
    this.setState({ snap: repairSnapshot({ ...this.state.snap, [t]: this.mergeWithOutbox(t, rows.map((r) => normalize(t, r))) }) });
  }

  async refresh() {
    if (!supabase) return;
    const results = await Promise.all(TABLES.map((t) => this.fetchTable(t, this.state.loadedFrom)));
    if (results.some((r) => r === null)) {
      this.setState({ online: false });
      return;
    }
    const snap = { ...this.state.snap };
    TABLES.forEach((t, i) => {
      (snap as unknown as Record<string, Row[]>)[t] = this.mergeWithOutbox(t, results[i]!.map((r) => normalize(t, r)));
    });
    this.setState({ snap, online: true });
    void this.persist();
    const { data } = await supabase.from('profiles').select('id,name');
    for (const p of data ?? []) this.profiles.set(p.id as string, p.name as string);
  }

  /** 월별 화면 등에서 예전 날짜를 볼 때 추가로 불러온다 */
  async ensureFrom(date: string) {
    if (!supabase || date >= this.state.loadedFrom) return;
    const until = this.state.loadedFrom;
    for (const t of DATED) {
      const { data } = await supabase.from(t).select('*').gte('date', date).lt('date', until);
      if (data) this.setState({ snap: applyMutations(this.state.snap, data.map((row) => ({ table: t, op: 'upsert', row: normalize(t, row as Row) }))) });
    }
    this.setState({ loadedFrom: date });
  }

  private mergeWithOutbox(t: TableName, rows: Row[]): Row[] {
    const m = new Map(rows.map((r) => [r.id, r]));
    for (const mut of this.outbox.values()) {
      if (mut.table !== t) continue;
      if (mut.op === 'upsert') m.set(mut.row.id, mut.row);
      else m.delete(mut.id);
    }
    return [...m.values()];
  }

  private subscribeRealtime() {
    if (!supabase) return;
    this.channel = supabase
      .channel('db')
      .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
        const t = payload.table as TableName;
        if (!TABLES.includes(t)) return;
        const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Row;
        if (!row?.id) return;
        if (this.outbox.has(`${t}:${row.id}`)) return; // 내 변경이 아직 전송 전 — 내 것이 마지막 저장
        const mine = row.updated_by === this.state.session?.userId;
        if (!mine && this.watched.has(row.id)) {
          this.toast('다른 사용자가 방금 이 항목을 수정했습니다 (마지막 저장 우선)', 'warn');
        }
        if (t === 'notices' && payload.eventType === 'INSERT') {
          const n = row as unknown as { driver_id: string | null; message: string };
          if (n.driver_id && n.driver_id === this.state.session?.driverId) this.onNotice?.(n.message);
          else if (!n.driver_id && this.state.session?.role !== 'viewer') this.toast(n.message, 'warn');
        }
        const m: Mutation = payload.eventType === 'DELETE' ? { table: t, op: 'delete', id: row.id } : { table: t, op: 'upsert', row: normalize(t, row) };
        this.setState({ snap: applyMutations(this.state.snap, [m]) });
        void this.persist();
      })
      .subscribe();
  }
}

export function demoDataKind(): DemoData {
  try {
    return localStorage.getItem('demo-data') === 'sample' ? 'sample' : 'base';
  } catch {
    return 'base';
  }
}

/** 이 기기에 저장된 데모 데이터 (없으면 null) */
export async function savedDemoData(): Promise<Snapshot | null> {
  return (await get<Snapshot>('snap:demo').catch(() => undefined)) ?? null;
}

function key(m: Mutation) {
  return `${m.table}:${m.op === 'upsert' ? m.row.id : m.id}`;
}

function isNetworkError(e: { message?: string; code?: string }) {
  return !e.code && /fetch|network|Failed to fetch|Load failed/i.test(e.message ?? '');
}

/** DB numeric → number, 로컬 전용 필드 제거 */
function normalize(t: TableName, r: Row): Row {
  const out = { ...r };
  for (const k of ['quantity', 'default_quantity', 'unit_price', 'supply_amount', 'vat', 'total', 'cost', 'temp_min', 'temp_max']) {
    if (typeof out[k] === 'string') out[k] = Number(out[k]);
  }
  void t;
  return out;
}

/** updated_at 은 서버 트리거가 채운다 */
function stripLocal(_t: TableName, r: Record<string, unknown>) {
  const { updated_at: _u, ...rest } = r;
  return rest;
}

export const store = new Store();
