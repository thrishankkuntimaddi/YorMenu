import { T } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useLive, beep } from '../live';
import { useSession } from '../session';
import { Loading, useAction, useLoad, useTick, useToast } from '../ui';
import { elapsed, minutesSince } from '../format';
import { printKot } from './OrderScreen';
import { getDevicePrinter } from '../devicePrinter';
import { Icon } from '../icons';
import type { KitchenKot } from '../types';

const NEXT: Record<string, string> = { queued: 'cooking', cooking: 'ready', ready: 'cooking' };
const LATE_MIN = 20;

function usePref(key: string, initial: boolean) {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem(key); return s === null ? initial : s === '1'; } catch { return initial; } });
  const set = (x: boolean) => { setV(x); try { localStorage.setItem(key, x ? '1' : '0'); } catch { /* ignore */ } };
  return [v, set] as const;
}

export default function Kitchen() {
  const { can, me } = useSession();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api.get<KitchenKot[]>('/kitchen'));
  const { run } = useAction();
  const [autoPrint, setAutoPrint] = usePref('yormenu.kds.autoprint', false);
  const [showReady, setShowReady] = usePref('yormenu.kds.showready', false);
  const printing = useRef(Promise.resolve());
  const editable = can('kitchen.update');
  useTick(20000);

  useLive(['kitchen:changed', 'order:changed', 'reconnect'], reload);
  useLive(['kot:new'], (p: { kotId: number }) => {
    reload();
    beep(3);
    toast('New KOT received', 'alert');
    // Print one ticket at a time so they never interleave.
    // A network kitchen printer already gets every KOT from the counter PC; this prints on the kitchen's own printer.
    if (autoPrint && (!me?.restaurant.settings.hasKotPrinter || getDevicePrinter()?.kots)) printing.current = printing.current.then(() => printKot(p.kotId)).catch(() => toast('Could not print KOT', 'err'));
  });
  useEffect(() => { const t = setInterval(reload, 60000); return () => clearInterval(t); }, [reload]);

  if (!data) return <Loading error={error} />;
  const kots = data.filter((k) => showReady || k.items.some((i) => i.status === 'queued' || i.status === 'cooking'));
  const pending = data.flatMap((k) => k.items).filter((i) => i.status === 'queued' || i.status === 'cooking');
  // Total quantity per dish across all open KOTs, so the kitchen can batch.
  const totals = Object.entries(pending.reduce<Record<string, number>>((m, i) => ({ ...m, [i.name]: (m[i.name] ?? 0) + i.qty }), {})).sort((a, b) => b[1] - a[1]);

  const setItem = (id: number, status: string) => run(async () => { await api.post(`/items/${id}/status`, { status }); reload(); });
  const setKot = (id: number, status: string) => run(async () => { await api.post(`/kots/${id}/status`, { status }); reload(); });

  return (
    <div className="page">
      <div className="page-head">
        <h1><T>Kitchen</T></h1>
        <span className="muted">{kots.length} open KOT{kots.length === 1 ? '' : 's'} · {pending.length} items to cook</span>
        <label className="check"><input type="checkbox" checked={showReady} onChange={(e) => setShowReady(e.target.checked)} /><T>Show ready</T></label>
        <label className="check" title="Prints each new KOT on this device's printer"><input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} /><T>Auto-print KOTs</T></label>
      </div>
      {totals.length > 0 && (
        <div className="card pad" style={{ marginBottom: 12 }}>
          <div className="small muted" style={{ marginBottom: 6 }}><T>To cook now (all tables)</T></div>
          <div className="row wrap">{totals.map(([n, q]) => <span key={n} className="pill" style={{ fontSize: 13 }}><b>{q}×</b> {n}</span>)}</div>
        </div>
      )}
      {!kots.length && <div className="empty">All caught up. New orders will appear here with a beep.</div>}
      <div className="kds">
        {kots.map((k) => {
          const late = minutesSince(k.created_at) >= LATE_MIN && k.items.some((i) => i.status !== 'ready');
          return (
            <div key={k.id} className={`kot ${late ? 'late' : ''}`}>
              <div className="kot-top">
                <div>
                  <div className="where">{k.where}</div>
                  <div className="small">KOT #{k.kot_no} · {k.server_name ?? k.created_by_name ?? ''}{k.source === 'qr' ? ' · QR' : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800 }}>{elapsed(k.created_at)}</div>
                  <button className="btn ghost sm" onClick={() => run(() => printKot(k.id))} title="Print"><Icon name="printer" size={16} /></button>
                </div>
              </div>
              {k.items.map((i) => (
                <div key={i.id} className={`kot-item ${i.status === 'ready' ? 'ready' : ''}`} onClick={() => editable && setItem(i.id, NEXT[i.status])}
                  role={editable ? 'button' : undefined} title={editable ? 'Tap to change status' : undefined}>
                  <span className="qn">{i.qty}×</span>
                  <div className="grow"><div style={{ fontWeight: 700 }}>{i.name}</div>{i.note && <div className="note">› {i.note}</div>}</div>
                  <span className={`pill ${i.status}`}>{i.status === 'queued' ? 'New' : i.status === 'cooking' ? 'Cooking' : 'Ready'}</span>
                </div>
              ))}
              {editable && (
                <div className="kot-actions">
                  {k.items.some((i) => i.status === 'queued') && <button className="btn sm grow" onClick={() => setKot(k.id, 'cooking')}><T>Start all</T></button>}
                  {k.items.some((i) => i.status !== 'ready') && <button className="btn sm ok grow" onClick={() => setKot(k.id, 'ready')}><T>All ready</T></button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
