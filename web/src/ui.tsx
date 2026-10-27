import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

type Toast = { id: number; text: string; kind: 'info' | 'ok' | 'err' | 'alert'; onClick?: () => void };
const ToastCtx = createContext<(text: string, kind?: Toast['kind'], onClick?: () => void) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info', onClick?: () => void) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-4), { id, text, kind, onClick }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'alert' ? 9000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts no-print" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => { t.onClick?.(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Wrap an async action: shows errors as toasts and tracks busy state. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (okText) toast(okText, 'ok');
      return r;
    } catch (e: any) {
      toast(e?.message ?? 'Something went wrong', 'err');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, run };
}

/** Load data once and expose a reload function. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { setData(await fn()); setError(null); } catch (e: any) { setError(e?.message ?? 'Failed to load'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload, setData };
}

export function Loading({ error }: { error?: string | null }) {
  return <div className="empty">{error ? <span className="err">{error}</span> : 'Loading…'}</div>;
}

/** Tiny ticking hook so "12 min" labels stay fresh. */
export function useTick(ms = 30000) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}

export function VegMark({ veg }: { veg: number | boolean }) {
  return <span className={`veg ${veg ? '' : 'non'}`} title={veg ? 'Veg' : 'Non-veg'} />;
}

export function PromptModal({ title, label, placeholder, confirmText = 'OK', danger, onSubmit, onClose, required = true }: {
  title: string; label: string; placeholder?: string; confirmText?: string; danger?: boolean; required?: boolean;
  onSubmit: (value: string) => void | Promise<void>; onClose: () => void;
}) {
  const [v, setV] = useState('');
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Back</button>
      <button className={`btn ${danger ? 'primary' : 'dark'}`} disabled={required && !v.trim()} onClick={() => onSubmit(v)}>{confirmText}</button>
    </>}>
      <label>{label}<input autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (!required || v.trim()) && onSubmit(v)} /></label>
    </Modal>
  );
}
