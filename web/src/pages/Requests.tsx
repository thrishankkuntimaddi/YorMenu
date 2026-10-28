import { T } from '../i18n';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { Loading, useAction, useLoad, useTick } from '../ui';
import { elapsed, rupees } from '../format';
import { Icon } from '../icons';

type Req = {
  id: number; table_id: number; table_label: string; kind: 'join' | 'order' | 'call_waiter' | 'request_bill'; created_at: string;
  payload: { note?: string; name?: string; phone?: string };
  items: { menuItemId: number; name: string; qty: number; price: number; note?: string }[];
  verified: boolean; order_table_label: string | null; table_phones: { name: string; phone: string }[];
};

const KIND: Record<string, string> = { join: 'Wants to order from their phone', order: 'Order from the table', call_waiter: 'Calling a server', request_bill: 'Asking for the bill' };

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
    if (accept && r.kind === 'order' && res.orderId) nav(`/order/${res.orderId}`);
  }, accept ? ({ join: 'Phone approved for this table', order: 'Order sent to kitchen' } as Record<string, string>)[r.kind] ?? 'Marked as attended' : 'Dismissed');

  return (
    <div className="page">
      <div className="page-head"><h1><T>Guest requests</T></h1><span className="muted"><T>From the QR code on each table</T></span></div>
      {!data.length && <div className="empty"><T>Nothing waiting.</T></div>}
      <div className="grid2">
        {data.map((r) => (
          <div key={r.id} className={`card pad stack req-card ${r.kind}`}>
            <div className="row between"><h2>Table {r.table_label}</h2><span className="small muted">{elapsed(r.created_at)} ago</span></div>
            <div className="pill" style={{ justifySelf: 'start' }}>{KIND[r.kind]}</div>

            {r.kind === 'join' && (
              <>
                <div className="row between">
                  <div><b>{r.payload.name}</b><div className="small muted">{r.payload.phone}</div></div>
                  {r.payload.phone && !r.payload.phone.includes('x') && <a className="btn sm" href={`tel:${r.payload.phone}`}><Icon name="phone" size={16} />Call</a>}
                </div>
                {r.table_phones.length > 0
                  ? <div className="req-warn">This table already orders from: {r.table_phones.map((p) => `${p.name} (${p.phone})`).join(', ')}. Allow only if they are together.</div>
                  : <div className="small muted">Check the person is sitting at this table before allowing.</div>}
              </>
            )}
            {(r.kind === 'order' || r.kind === 'request_bill') && (
              r.verified
                ? <div className="req-ok">✓ From an approved phone{r.payload.name ? ` (${r.payload.name})` : ''}{r.order_table_label && r.order_table_label !== r.table_label ? ` · now at Table ${r.order_table_label}` : ''}</div>
                : <div className="req-warn">⚠ This phone is not approved for any table. It cannot order.</div>
            )}

            {r.items.length > 0 && (
              <div>
                {r.items.map((i, n) => <div key={n} className="row between"><span>{i.qty} × {i.name}{i.note ? <span className="small muted"> › {i.note}</span> : null}</span><span className="small">{rupees(i.price * i.qty)}</span></div>)}
              </div>
            )}
            {r.payload.note && <div className="small muted">“{r.payload.note}”</div>}
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => handle(r, false)}>{r.kind === 'join' ? 'Deny' : r.kind === 'order' ? 'Reject' : 'Dismiss'}</button>
              {r.kind === 'join' && <button className="btn primary grow" disabled={busy} onClick={() => handle(r, true)}>Allow this phone</button>}
              {r.kind === 'order' && r.verified && <button className="btn primary grow" disabled={busy} onClick={() => handle(r, true)}>Accept &amp; send to kitchen</button>}
              {(r.kind === 'call_waiter' || r.kind === 'request_bill') && <button className="btn primary grow" disabled={busy} onClick={() => handle(r, true)}>On my way</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
