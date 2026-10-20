import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

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
        <Backdrop key={i} onClose={close}>{r(close)}</Backdrop>
      ))}
    </Ctx.Provider>
  );
}

/**
 * 바깥(어두운 부분)을 눌러 닫기 — 누르기 시작한 곳과 뗀 곳이 모두 바깥일 때만.
 * (입력칸을 닫으면 시트 높이가 줄어 손가락이 바깥에서 떨어지는 경우 시트가 닫히던 문제 방지)
 */
function Backdrop({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const downOutside = useRef(false);
  return (
    <div
      className="sheet-backdrop"
      onPointerDown={(e) => (downOutside.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOutside.current) onClose();
        downOutside.current = false;
      }}
    >
      {children}
    </div>
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
