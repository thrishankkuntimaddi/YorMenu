import { useEffect, useState } from 'react';
import { api } from '../api';
import { Loading, Modal, PromptModal, useAction, useLoad } from '../ui';
import { SUB_TEXT } from './Subscription';

const P = api.platform;

/** New shops that registered themselves: check documents, then approve or reject. */
export function Signups() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const { data, error, reload } = useLoad(() => P.get<any[]>(`/platform/signups?status=${status}`), [status]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="page-head"><h1>Sign-ups</h1>
        <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="pending">Waiting</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
        </select>
      </div>
      {!data ? <Loading error={error} /> : !data.length ? <div className="empty">Nothing here.</div> : (
        <div className="card table-wrap"><table className="list"><tbody>
          {data.map((s) => (
            <tr key={s.uid} className="click" onClick={() => setOpen(s.uid)}>
              <td><b>{s.businessName}</b><div className="small faint">{s.businessType === 'counter' ? 'Shop / stall' : 'Restaurant'} · {s.city}, {s.state}</div></td>
              <td>{s.ownerName}<div className="small faint">{s.mobile}</div></td>
              <td className="small">{s.created_at?.slice(0, 16)}</td>
              <td>{s.code ? <b>{s.code}</b> : null}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {open && <SignupDetail uid={open} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function SignupDetail({ uid, onClose }: { uid: string; onClose: () => void }) {
  const { data, error } = useLoad(() => P.get<any>(`/platform/signups/${uid}`), [uid]);
  const [reject, setReject] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const { run, busy } = useAction();
  if (!data) return <Modal title="Sign-up" onClose={onClose}><Loading error={error} /></Modal>;
  const row = (k: string, v: string) => v ? <div className="row between"><span className="muted">{k}</span><b style={{ textAlign: 'right' }}>{v}</b></div> : null;
  return (
    <Modal wide title={data.businessName} onClose={onClose}
      footer={data.status === 'pending' && !made ? <>
        <button className="btn danger" onClick={() => setReject(true)}>Reject</button>
        <button className="btn primary" disabled={busy} onClick={() => run(async () => { const r = await P.post<{ code: string }>(`/platform/signups/${uid}/approve`); setMade(r.code); }, 'Approved. Shop created.')}>Approve &amp; create shop</button>
      </> : <button className="btn" onClick={onClose}>Close</button>}>
      {made && <div className="callout">Shop created. Code <b>{made}</b>. Call {data.ownerName} on {data.mobile} to tell them. They log in with this code, username <b>{data.username}</b> and their own password.</div>}
      <div className="grid2">
        <div className="stack" style={{ gap: 4 }}>
          {row('Type', data.businessType === 'counter' ? 'Shop / food stall' : 'Restaurant')}
          {row('Owner', data.ownerName)}
          {row('Mobile', data.mobile)}
          {row('Email', data.email)}
          {row('Address', `${data.address}, ${data.city}, ${data.state}`)}
          {row('FSSAI no.', data.fssai)}
          {row('GSTIN', data.gstin)}
          {row('Username', data.username)}
          {row('Status', data.status + (data.reason ? `: ${data.reason}` : ''))}
          {data.mobile && <a className="btn sm" href={`tel:${data.mobile}`}>Call {data.mobile}</a>}
        </div>
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          {data.files.map((f: any) => (
            <button key={f.n} className="card" style={{ padding: 6, cursor: 'zoom-in' }} onClick={() => setZoom(`data:${f.type};base64,${f.data}`)}>
              <img src={`data:${f.type};base64,${f.data}`} alt={f.kind} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6 }} />
              <div className="small">{({ fssai: 'FSSAI', id: 'ID proof', gst: 'GST', shop_photo: 'Shop photo', other: 'Other' } as Record<string, string>)[f.kind]}</div>
            </button>
          ))}
        </div>
      </div>
      {zoom && <Modal wide title="Document" onClose={() => setZoom(null)}><img src={zoom} alt="" style={{ width: '100%' }} /></Modal>}
      {reject && <PromptModal title="Reject this sign-up?" label="Reason (they will see it)" danger confirmText="Reject" onClose={() => setReject(false)}
        onSubmit={(reason) => run(async () => { await P.post(`/platform/signups/${uid}/reject`, { reason }); setReject(false); onClose(); }, 'Rejected')} />}
    </Modal>
  );
}

/** UPI payments reported by owners: check the bank statement, then confirm or reject. */
export function Payments() {
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'rejected'>('pending');
  const { data, error, reload } = useLoad(() => P.get<any[]>(`/platform/payments?status=${status}`), [status]);
  const [rej, setRej] = useState<any>(null);
  const { run, busy } = useAction();
  return (
    <div className="stack">
      <div className="page-head"><h1>Subscription payments</h1>
        <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="pending">To check</option><option value="confirmed">Confirmed</option><option value="rejected">Rejected</option>
        </select>
      </div>
      <div className="small muted">Match the UTR with your bank / UPI app before confirming. Confirming adds the plan's days to the shop.</div>
      {!data ? <Loading error={error} /> : !data.length ? <div className="empty">Nothing here.</div> : (
        <div className="card table-wrap"><table className="list"><tbody>
          {data.map((p) => (
            <tr key={p.id}>
              <td><b>{p.restaurant}</b> <span className="faint small">{p.code}</span><div className="small faint">{p.state ? `${SUB_TEXT[p.state.status as keyof typeof SUB_TEXT]}${p.state.until ? ` till ${p.state.until}` : ''}` : ''}</div></td>
              <td>{p.plan_name}<div className="small faint">₹{p.amount} · {p.days} days</div></td>
              <td className="small">UTR <b>{p.utr}</b><div className="faint">{p.created_at?.slice(0, 16)} · {p.by_name}</div></td>
              <td className="r">{p.status === 'pending' && <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn sm" onClick={() => setRej(p)}>Reject</button>
                <button className="btn sm ok" disabled={busy} onClick={() => run(async () => { await P.post(`/platform/payments/${p.id}/confirm`); reload(); }, 'Payment confirmed')}>Confirm</button>
              </div>}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {rej && <PromptModal title="Reject payment?" label="Note for the owner" danger confirmText="Reject" onClose={() => setRej(null)}
        onSubmit={(note) => run(async () => { await P.post(`/platform/payments/${rej.id}/reject`, { note }); setRej(null); reload(); }, 'Rejected')} />}
    </div>
  );
}

/** Where owners pay (UPI) and what the plans cost. */
export function BillingSettings() {
  const { data, error } = useLoad(() => P.get<any>('/platform/billing'));
  const [f, setF] = useState<any>(null);
  const { run, busy } = useAction();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return <Loading error={error} />;
  const setPlan = (i: number, patch: object) => setF({ ...f, plans: f.plans.map((p: any, j: number) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="page-head"><h1>Plans &amp; payment</h1></div>
      <div className="card pad stack">
        <div className="grid2">
          <label>Your UPI ID (owners pay here)<input value={f.upiId} onChange={(e) => setF({ ...f, upiId: e.target.value.trim() })} placeholder="name@okhdfcbank" /></label>
          <label>Name shown in UPI apps<input value={f.payeeName} onChange={(e) => setF({ ...f, payeeName: e.target.value })} /></label>
          <label>Free trial (days)<input inputMode="numeric" value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>
        </div>
      </div>
      <div className="card pad stack">
        <h2>Plans</h2>
        {f.plans.map((p: any, i: number) => (
          <div key={i} className="row wrap" style={{ alignItems: 'end' }}>
            <label className="grow">Name<input value={p.name} onChange={(e) => setPlan(i, { name: e.target.value })} /></label>
            <label style={{ width: 110 }}>Price ₹<input inputMode="numeric" value={p.price} onChange={(e) => setPlan(i, { price: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>
            <label style={{ width: 90 }}>Days<input inputMode="numeric" value={p.days} onChange={(e) => setPlan(i, { days: Number(e.target.value.replace(/\D/g, '')) || 1 })} /></label>
            <label style={{ width: 150 }}>For
              <select value={p.for} onChange={(e) => setPlan(i, { for: e.target.value })}>
                <option value="counter">Shops / stalls</option><option value="restaurant">Restaurants</option><option value="all">Everyone</option>
              </select>
            </label>
            <button className="btn ghost danger" onClick={() => setF({ ...f, plans: f.plans.filter((_: any, j: number) => j !== i) })}>✕</button>
          </div>
        ))}
        <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => setF({ ...f, plans: [...f.plans, { id: `plan-${Date.now() % 100000}`, name: 'New plan', price: 0, days: 30, for: 'all' }] })}>+ Plan</button>
      </div>
      <button className="btn primary" style={{ justifySelf: 'start' }} disabled={busy} onClick={() => run(async () => { setF(await P.put('/platform/billing', f)); }, 'Saved')}>Save</button>
    </div>
  );
}
