import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useLive } from './live';
import { useSession } from './session';

type Desktop = {
  isDesktop: true;
  print: (html: string) => Promise<void>;
  printRaw?: (host: string, port: number, base64: string) => Promise<void>;
};
const desktop = () => (window as unknown as { yormenuDesktop?: Desktop }).yormenuDesktop;

const KEY = 'yormenu.printStation';
export function stationEnabled() { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } }
export function setStationEnabled(on: boolean) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ } }

/**
 * Runs inside the YorMenu desktop app on the counter PC: picks up KOT/bill print jobs
 * from the cloud and sends them to the LAN thermal printers. Shows a small status chip.
 */
export default function PrintStation() {
  const { can } = useSession();
  const d = desktop();
  const active = !!d?.printRaw && can('print.station') && stationEnabled();
  const busy = useRef(false);
  const [state, setState] = useState<{ printed: number; error: string }>({ printed: 0, error: '' });

  const work = useCallback(async () => {
    if (!active || busy.current) return;
    busy.current = true;
    try {
      const jobs = await api.get<any[]>('/print-jobs');
      for (const j of jobs) {
        const { job } = await api.post<{ job: any }>(`/print-jobs/${j.id}/claim`);
        if (!job) continue;
        try {
          await d!.printRaw!(job.host, job.port, job.data);
          await api.post(`/print-jobs/${job.id}/done`, { ok: true });
          setState((s) => ({ printed: s.printed + 1, error: '' }));
        } catch (e: any) {
          const error = String(e?.message ?? e).slice(0, 200);
          await api.post(`/print-jobs/${job.id}/done`, { ok: false, error }).catch(() => {});
          setState((s) => ({ ...s, error: `${job.label}: ${error}` }));
        }
      }
    } catch { /* offline: next signal or tick retries */ } finally { busy.current = false; }
  }, [active, d]);

  useLive(['print:new', 'reconnect'], work);
  useEffect(() => {
    if (!active) return;
    work();
    const t = setInterval(work, 30_000);
    return () => clearInterval(t);
  }, [active, work]);

  if (!active) return null;
  return (
    <span className={`pill ${state.error ? 'void' : 'served'}`} title={state.error || `This PC prints KOTs and bills (${state.printed} printed)`}>
      🖨 {state.error ? 'Printer problem' : 'Print station'}
    </span>
  );
}
