// 도메인 로직은 Snapshot 을 직접 바꾸지 않고 Tx 위에서 작업한 뒤
// Mutation[] (서버/로컬 저장소에 그대로 적용 가능한 변경 목록) 을 돌려준다.
import type { Mutation, Snapshot, TableName } from './types.ts';

type Row = { id: string } & Record<string, unknown>;
type RowOf<T extends TableName> = Snapshot[T][number];

export class Tx {
  private tables = new Map<TableName, Map<string, Row>>();
  private created = new Set<string>();
  private ops = new Map<string, Mutation>();
  readonly snap: Snapshot;
  readonly actor: string | null;
  readonly now: string;

  constructor(snap: Snapshot, opts: { actor?: string | null; now?: string } = {}) {
    this.snap = snap;
    this.actor = opts.actor ?? null;
    this.now = opts.now ?? new Date().toISOString();
  }

  private table(t: TableName): Map<string, Row> {
    let m = this.tables.get(t);
    if (!m) {
      m = new Map((this.snap[t] as unknown as Row[]).map((r) => [r.id, r]));
      this.tables.set(t, m);
    }
    return m;
  }

  list<T extends TableName>(t: T): RowOf<T>[] {
    return [...this.table(t).values()] as unknown as RowOf<T>[];
  }

  get<T extends TableName>(t: T, id: string | null | undefined): RowOf<T> | undefined {
    if (!id) return undefined;
    return this.table(t).get(id) as unknown as RowOf<T> | undefined;
  }

  insert<T extends TableName>(t: T, row: RowOf<T>): RowOf<T> {
    const r = { ...(row as unknown as Row), updated_at: this.now, updated_by: this.actor };
    this.table(t).set(r.id, r);
    this.created.add(`${t}:${r.id}`);
    this.ops.set(`${t}:${r.id}`, { table: t, op: 'upsert', row: r });
    return r as unknown as RowOf<T>;
  }

  update<T extends TableName>(t: T, id: string, patch: Partial<RowOf<T>>): RowOf<T> {
    const cur = this.table(t).get(id);
    if (!cur) throw new Error(`${t}:${id} 없음`);
    const r = { ...cur, ...(patch as Record<string, unknown>), updated_at: this.now, updated_by: this.actor } as Row;
    this.table(t).set(id, r);
    this.ops.set(`${t}:${id}`, { table: t, op: 'upsert', row: r });
    return r as unknown as RowOf<T>;
  }

  remove(t: TableName, id: string): void {
    if (!this.table(t).has(id)) return;
    this.table(t).delete(id);
    const key = `${t}:${id}`;
    if (this.created.has(key)) {
      this.ops.delete(key);
      this.created.delete(key);
    } else {
      this.ops.set(key, { table: t, op: 'delete', id });
    }
  }

  mutations(): Mutation[] {
    return [...this.ops.values()];
  }

  /** 변경을 반영한 새 Snapshot (테스트·미리보기용) */
  result(): Snapshot {
    const out = { ...this.snap };
    for (const [t, m] of this.tables) (out as unknown as Record<string, Row[]>)[t] = [...m.values()];
    return out;
  }
}

export function applyMutations(snap: Snapshot, muts: Mutation[]): Snapshot {
  const out = { ...snap } as unknown as Record<string, Row[]>;
  const touched = new Map<string, Map<string, Row>>();
  for (const m of muts) {
    let tbl = touched.get(m.table);
    if (!tbl) {
      tbl = new Map(out[m.table].map((r) => [r.id, r]));
      touched.set(m.table, tbl);
    }
    if (m.op === 'upsert') tbl.set(m.row.id, m.row);
    else tbl.delete(m.id);
  }
  for (const [t, m] of touched) out[t] = [...m.values()];
  return out as unknown as Snapshot;
}
