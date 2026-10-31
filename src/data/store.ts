// 오프라인 우선 저장소: 화면은 메모리 Snapshot 을 보고, 변경은 즉시 로컬 반영 → IndexedDB 캐시 →
// outbox 에 쌓았다가 온라인이면 Supabase 로 전송. 다른 사람 변경은 Realtime 으로 받는다 (마지막 저장 우선).
import { del, get, set } from 'idb-keyval';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  TABLES, Tx, addDays, carryDriverless, inverseMutations, lockedMutations, LOCK_DAYS, applyMutations, emptySnapshot, planFieldExtension, dedupeFieldRows, repairShipLinks, repairSnapshot, planRecurringExtension, toBatches,
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
  /** 되돌릴 수 있는 작업 수 */
  undoCount: number;
  /** 저장하려는데 다른 사용자가 먼저 고친 경우 (화면에 알림) */
  conflict: EditConflict | null;
}

export interface EditConflict {
  seq: number;
  by: string;
  table: TableName;
  id: string;
}

/** 동시 수정 검사를 하는 표 (서버 트리거 a_edit_conflict 와 같게) */
const CONFLICT_TABLES: TableName[] = ['daily_orders', 'vehicle_days', 'field_assignments', 'clients', 'products', 'vehicles', 'drivers', 'ships'];
/** 화면을 연 뒤 이 시간이 지나면 기준 시각을 버린다 (오래 열어 둔 화면) */
const EXPECT_TTL = 15 * 60 * 1000;

/** 되돌리기 한 번 = 작업 한 번(저장 버튼·메뉴 한 번)에 생긴 변경 전체 */
interface UndoEntry {
  inverse: Mutation[];
  at: number;
}
const UNDO_MAX = 30;

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
    undoCount: 0,
    conflict: null,
  };
  /** 보낼 줄 → "내가 본 시점의 수정시각" (서버가 그 뒤 다른 사람이 먼저 고쳤는지 확인) */
  private bases = new Map<string, string>();
  /** 고치기 시작한 줄 → 그때 수정시각 (다음 저장 때 bases 로 옮김) */
  private expected = new Map<string, { base: string; at: number }>();
  /** 서버에 동시 수정 SQL 을 아직 안 넣었으면 기준 시각 없이 보낸다 */
  private noEditBase = false;
  private conflictSeq = 0;
  private undoStack: UndoEntry[] = [];
  private listeners = new Set<() => void>();
  private outbox = new Map<string, Mutation>();
  private flushing = false;
  private channel: RealtimeChannel | null = null;
  private toastSeq = 0;
  /** 지금 편집 중인 행 — 다른 사람이 바꾸면 알림 */
  watched = new Set<string>();
  /** 수정자 표시용 사용자 이름 */
  profiles = new Map<string, string>();
  /** 내 정보에서 이름을 바꿨을 때 화면의 이름도 바로 */
  setSessionName(name: string) {
    const s = this.state.session;
    if (s) this.setState({ session: { ...s, name } });
    if (s?.userId) this.profiles.set(s.userId, name);
  }

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
    document.removeEventListener('visibilitychange', this.onVisible);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  async stop() {
    if (this.channel) await supabase?.removeChannel(this.channel);
    this.channel = null;
    this.undoStack = [];
    this.setState({ session: null, snap: emptySnapshot(), ready: false, undoCount: 0 });
  }

  async resetDemo(kind: DemoData) {
    await del('snap:demo');
    localStorage.setItem('demo-data', kind);
    this.outbox.clear();
    this.undoStack = [];
    this.setState({ snap: initialSnapshot(kind, seoulToday()), pending: 0, undoCount: 0 });
    void this.persist();
  }

  /** 백업 파일 복원 (데모 모드: 이 기기 데이터를 통째로 바꾼다) */
  replaceSnapshot(snap: Snapshot) {
    this.outbox.clear();
    this.undoStack = [];
    this.setState({ snap: repairSnapshot(snap), pending: 0, undoCount: 0 });
    void this.persist();
  }

  /** 앱이 열릴 때도 반복 발주를 오늘+8주까지 연장 (새벽 스케줄러가 멈췄을 때 대비) */
  private extendRecurring() {
    const today = seoulToday();
    const a = planRecurringExtension(this.state.snap, today, this.actor());
    const b = planFieldExtension(a.snapshot, today, this.actor());
    // 예전에 저장된 "대기"·"익일선적" 짐의 반대편 하차·도착 선박 바로잡기
    const fix = new Tx(b.snapshot, { actor: this.actor() });
    repairShipLinks(fix, addDays(today, -LOCK_DAYS));
    // 같은 날 같은 사람 현장근무 줄이 겹친 것 정리 (일정표에 두 번 나오던 문제)
    dedupeFieldRows(fix, addDays(today, -LOCK_DAYS));
    const muts = [...a.mutations, ...b.mutations, ...fix.mutations()];
    if (muts.length) this.commit(muts, { auto: true });
    // 지난 날 기사 없이 남은 차량 일정은 처리 안 된 것 → 같은 차량 그대로 오늘로 넘긴다 (잘못 넘어갔으면 ↩ 되돌리기)
    const carry = new Tx(this.state.snap, { actor: this.actor() });
    const carried = carryDriverless(carry, today, LOCK_DAYS);
    if (carried && this.commit(carry.mutations())) {
      this.toast(`기사 없이 남은 지난 일정 ${carried}건을 오늘(${today.slice(5).replace('-', '/')})로 넘겼습니다`);
    }
    this.extendedOn = today;
  }

  /** 앱을 켜 둔 채 날짜가 바뀌면 (다시 화면을 볼 때) 한 번 더 */
  private extendedOn = '';
  private onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    const role = this.state.session?.role;
    if (!this.state.ready || !role || role === 'viewer' || this.extendedOn === seoulToday()) return;
    this.extendRecurring();
  };

  private actor() {
    const s = this.state.session;
    return s && !s.demo ? s.userId : null;
  }

  /**
   * 화면에 보이는 이 줄을 고치기 시작함 — 저장할 때 그 사이 다른 사람이 먼저 저장했으면
   * 서버가 거절하고 "다른 사용자(아이디)가 먼저 수정했습니다"를 띄운다.
   */
  expect(row: { id: string; updated_at?: string } | null | undefined) {
    if (!row?.id || !row.updated_at) return;
    this.expected.set(row.id, { base: row.updated_at, at: Date.now() });
  }

  /** 새 작업을 시작할 때: 예전 작업에서 남은 기준 시각을 비운다 (취소한 메뉴 등) */
  expectOnly(...rows: ({ id: string; updated_at?: string } | null | undefined)[]) {
    this.expected.clear();
    for (const r of rows) this.expect(r);
  }

  clearConflict() {
    this.setState({ conflict: null });
  }

  /** 이번 저장에서 기준 시각을 붙일 줄 고르기 */
  private attachBases(muts: Mutation[], undo: boolean) {
    const now = Date.now();
    for (const [id, e] of this.expected) if (now - e.at > EXPECT_TTL) this.expected.delete(id);
    for (const m of muts) {
      if (m.op !== 'upsert' || !CONFLICT_TABLES.includes(m.table)) continue;
      const id = m.row.id as string;
      const cur = (this.state.snap[m.table] as unknown as Row[]).find((r) => r.id === id);
      if (!cur) continue; // 새 줄
      // 되돌리기: 지금 화면 값 기준 (그 사이 다른 사람이 고쳤으면 덮어쓰지 않게)
      const base = undo ? (cur.updated_at as string | undefined) : this.expected.get(id)?.base;
      if (!undo) this.expected.delete(id);
      const k = `${m.table}:${id}`;
      if (base && !this.bases.has(k)) this.bases.set(k, base);
    }
    // 한 번 저장하면 그 작업은 끝 — 남은 기준 시각이 나중 연쇄 변경에 잘못 붙지 않게
    if (!undo) this.expected.clear();
  }

  /** 도메인 함수를 트랜잭션으로 실행하고 결과를 반영 */
  run<T>(fn: (tx: Tx) => T): T {
    const tx = new Tx(this.state.snap, { actor: this.actor() });
    const out = fn(tx);
    this.commit(tx.mutations());
    return out;
  }

  /**
   * 변경 반영. auto = 앱이 알아서 하는 정리(반복 연장 등) → 되돌리기 목록에 넣지 않음.
   * undo = 되돌리기 자체 → 다시 목록에 넣지 않음.
   */
  commit(muts: Mutation[], opts: { auto?: boolean; undo?: boolean } = {}): boolean {
    if (!muts.length) return true;
    const role = this.state.session?.role;
    if (role === 'viewer') {
      const allowed = muts.filter((m) => m.table === 'odometer_logs' || m.table === 'product_suggestions');
      if (allowed.length !== muts.length) {
        this.toast('조회 계정은 수정할 수 없습니다', 'warn');
        return false;
      }
    }
    // 배차 담당자는 일주일 지난 일정을 고칠 수 없다 (서버에서도 막음)
    if (role === 'dispatcher' && lockedMutations(this.state.snap, muts, seoulToday()).length) {
      if (!opts.auto) this.toast(`${LOCK_DAYS}일 지난 일정은 관리자만 수정할 수 있습니다`, 'warn');
      return false;
    }
    if (!opts.auto && !opts.undo && role !== 'viewer') {
      const inverse = inverseMutations(this.state.snap, muts, { at: new Date().toISOString(), by: this.actor() });
      if (inverse.length) {
        this.undoStack = [...this.undoStack, { inverse, at: Date.now() }].slice(-UNDO_MAX);
        this.setState({ undoCount: this.undoStack.length });
      }
    }
    if (!opts.auto && !this.state.session?.demo) this.attachBases(muts, !!opts.undo);
    this.setState({ snap: applyMutations(this.state.snap, muts) });
    if (!this.state.session?.demo) {
      for (const m of muts) this.outbox.set(key(m), m);
      this.setState({ pending: this.outbox.size });
      void this.flush();
    }
    void this.persist();
    return true;
  }

  /** 마지막 작업을 되돌린다 */
  undo() {
    const last = this.undoStack[this.undoStack.length - 1];
    if (!last) return;
    if (!this.commit(last.inverse, { undo: true })) return;
    this.undoStack = this.undoStack.slice(0, -1);
    this.setState({ undoCount: this.undoStack.length });
    this.toast('↩ 되돌렸습니다');
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
      let dupSkipped = 0;
      const conflicts: EditConflict[] = [];
      const out = (t: TableName, r: Record<string, unknown>) => {
        const base = this.noEditBase ? undefined : this.bases.get(`${t}:${r.id as string}`);
        return base ? { ...stripLocal(t, r), edit_base: base } : stripLocal(t, r);
      };
      const upsert = async (t: TableName, rows: Record<string, unknown>[]) => {
        let res = await supabase!.from(t).upsert(rows.map((r) => out(t, r)), { defaultToNull: false });
        // 서버에 edit_base 칸이 아직 없음(이번 업데이트 SQL 전) → 기준 시각 없이 다시
        if (res.error && !this.noEditBase && /edit_base/.test(res.error.message)) {
          this.noEditBase = true;
          res = await supabase!.from(t).upsert(rows.map((r) => out(t, r)), { defaultToNull: false });
        }
        return res;
      };
      const conflictOf = (t: TableName, r: Record<string, unknown>, e: { details?: string | null; message: string }): EditConflict => {
        let by = '';
        try { by = (JSON.parse(e.details ?? '{}') as { by?: string }).by ?? ''; } catch { /* 메시지에서 */ }
        return { seq: ++this.conflictSeq, by: by || e.message.replace(/\(이\)가 먼저 수정했습니다.*/, ''), table: t, id: r.id as string };
      };
      for (const b of toBatches([...sending.values()])) {
        const { error } = b.op === 'upsert'
          ? await upsert(b.table, b.rows)
          : await supabase.from(b.table).delete().in('id', b.ids);
        if (error) {
          if (isNetworkError(error)) throw error;
          // 중복(다른 기기·새벽 자동 연장이 같은 날 반복 오더를 먼저 만듦) · 그 때문에 빠진 오더를 가리키는 줄 ·
          // 다른 사용자가 먼저 고친 줄(GM409): 묶음 전체를 버리지 말고 한 줄씩 다시 보내서 걸리는 줄만 건너뛴다
          if (b.op === 'upsert' && (error.code === '23505' || error.code === '23503' || error.code === 'GM409')) {
            for (const r of b.rows) {
              const one = await upsert(b.table, [r]);
              if (!one.error) continue;
              if (isNetworkError(one.error)) throw one.error;
              if (one.error.code === 'GM409') conflicts.push(conflictOf(b.table, r, one.error));
              else if (one.error.code === '23505' && one.error.message.includes('recurring_once')) dupSkipped++;
              else if (one.error.code !== '23503') this.toast(`저장 실패 (${b.table}): ${one.error.message}`, 'error');
            }
          } else {
            // 권한·제약 오류: 이 묶음은 버리고 서버 상태로 되돌린다
            this.toast(`저장 실패 (${b.table}): ${error.message}`, 'error');
          }
          void this.refreshTable(b.table);
        }
        const done = b.op === 'upsert' ? b.rows.map((r) => `${b.table}:${r.id as string}`) : b.ids.map((id) => `${b.table}:${id}`);
        for (const k of done) {
          if (this.outbox.get(k) === sending.get(k)) {
            this.outbox.delete(k);
            this.bases.delete(k);
          }
        }
      }
      if (conflicts.length) {
        // 최신 값을 다시 받아 화면에 보여 주고, 다시 저장하게 한다
        for (const t of new Set(conflicts.map((c) => c.table))) await this.refreshTable(t);
        // 저장 안 된 작업은 되돌리기 목록에서도 뺀다 (되돌리면 남이 고친 값을 덮어씀)
        const hit = new Set(conflicts.map((c) => `${c.table}:${c.id}`));
        this.undoStack = this.undoStack.filter((e) => !e.inverse.some((m) => hit.has(key(m))));
        const last = conflicts[conflicts.length - 1];
        this.setState({ conflict: last, undoCount: this.undoStack.length });
      }
      if (dupSkipped) {
        this.toast(`다른 기기에서 이미 만든 반복 일정 ${dupSkipped}건은 건너뛰었습니다`);
        void this.refreshTable('daily_orders');
        void this.refreshTable('order_revenue');
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
          const who = this.profileName(row.updated_by as string | null) || '다른 사용자';
          this.toast(`${who}님이 방금 이 항목을 수정했습니다 — 화면을 최신 내용으로 바꿨습니다`, 'warn');
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
  for (const k of ['quantity', 'default_quantity', 'unit_price', 'supply_amount', 'vat', 'total', 'cost', 'temp_min', 'temp_max', 'overtime_hours', 'amount', 'fee']) {
    if (typeof out[k] === 'string') out[k] = Number(out[k]);
  }
  if (t === 'ship_fares') for (const k of ['base', 'empty', 'surcharge', 'boarding']) if (typeof out[k] === 'string') out[k] = Number(out[k]);
  return out;
}

/** updated_at 은 서버 트리거가 채운다 */
function stripLocal(_t: TableName, r: Record<string, unknown>) {
  const { updated_at: _u, ...rest } = r;
  return rest;
}

export const store = new Store();
