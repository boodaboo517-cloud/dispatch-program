import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Render = (close: () => void) => ReactNode;
interface SheetApi {
  open: (r: Render) => void;
  close: () => void;
  confirm: (p: { title: string; message?: string; actions: { label: string; value: string; kind?: 'primary' | 'danger' }[] }) => Promise<string | null>;
}

const Ctx = createContext<SheetApi | null>(null);
export const useSheet = () => useContext(Ctx)!;

export function SheetProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Render[]>([]);
  const close = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const open = useCallback((r: Render) => setStack((s) => [...s, r]), []);
  const confirm: SheetApi['confirm'] = useCallback((p) => new Promise((resolve) => {
    open((c) => (
      <Sheet title={p.title} onClose={() => { c(); resolve(null); }}>
        {p.message && <p style={{ whiteSpace: 'pre-wrap' }}>{p.message}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
          {p.actions.map((a) => (
            <button key={a.value} className={a.kind} onClick={() => { c(); resolve(a.value); }}>{a.label}</button>
          ))}
          <button className="ghost" onClick={() => { c(); resolve(null); }}>취소</button>
        </div>
      </Sheet>
    ));
  }), [open]);
  return (
    <Ctx.Provider value={{ open, close, confirm }}>
      {children}
      {stack.map((r, i) => (
        <div key={i} className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
          {r(close)}
        </div>
      ))}
    </Ctx.Provider>
  );
}

export function Sheet(p: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; flush?: boolean; right?: ReactNode }) {
  return (
    <div className="sheet" role="dialog">
      <div className="sheet-head">
        <h3>{p.title}</h3>
        {p.right}
        <button className="ghost" onClick={p.onClose} aria-label="닫기">✕</button>
      </div>
      <div className={`sheet-body${p.flush ? ' flush' : ''}`}>{p.children}</div>
      {p.footer && <div className="sheet-foot">{p.footer}</div>}
    </div>
  );
}
