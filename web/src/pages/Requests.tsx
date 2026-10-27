import { T } from '../i18n';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { Loading, useAction, useLoad, useTick } from '../ui';
import { elapsed, rupees } from '../format';

type Req = { id: number; table_id: number; table_label: string; kind: 'order' | 'call_waiter' | 'request_bill'; created_at: string; payload: { note?: string }; items: { menuItemId: number; name: string; qty: number; price: number; note?: string }[] };

const KIND: Record<string, string> = { order: 'New order from table', call_waiter: 'Calling a server', request_bill: 'Asking for the bill' };

export default function Requests() {
  const nav = useNavigate();
  const { data, error, reload } = useLoad(() => api.get<Req[]>('/guest-requests'));
  const { run, busy } = useAction();
  useLive(['guest:request', 'reconnect'], reload);
  useTick();
  if (!data) return <Loading error={error} />;
  const handle = (r: Req, accept: boolean) => run(async () => {
    const res = await api.post<{ orderId: number | null }>(`/guest-requests/${r.id}/${accept ? 'accept' : 'reject'}`);
    reload();
    if (accept && res.orderId) nav(`/order/${res.orderId}`);
  }, accept ? (r.kind === 'order' ? 'Order sent to kitchen' : 'Marked as attended') : 'Dismissed');
  return (
    <div className="page">
      <div className="page-head"><h1><T>Guest requests</T></h1><span className="muted"><T>From the QR code on each table</T></span></div>
      {!data.length && <div className="empty"><T>Nothing waiting.</T></div>}
      <div className="grid2">
        {data.map((r) => (
          <div key={r.id} className="card pad stack">
            <div className="row between"><h2>Table {r.table_label}</h2><span className="small muted">{elapsed(r.created_at)} ago</span></div>
            <div className="pill" style={{ justifySelf: 'start' }}>{KIND[r.kind]}</div>
            {r.items.length > 0 && (
              <div>
                {r.items.map((i, n) => <div key={n} className="row between"><span>{i.qty} × {i.name}{i.note ? <span className="small muted"> › {i.note}</span> : null}</span><span className="small">{rupees(i.price * i.qty)}</span></div>)}
              </div>
            )}
            {r.payload.note && <div className="small muted">“{r.payload.note}”</div>}
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => handle(r, false)}>{r.kind === 'order' ? 'Reject' : 'Dismiss'}</button>
              <button className="btn primary grow" disabled={busy} onClick={() => handle(r, true)}>{r.kind === 'order' ? 'Accept & send to kitchen' : 'On my way'}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
