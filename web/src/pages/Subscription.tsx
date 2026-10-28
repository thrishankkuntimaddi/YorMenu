import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api';
import { Loading, Modal, useAction, useLoad } from '../ui';
import type { SubState } from '../types';

type Plan = { id: string; name: string; price: number; days: number };
type Data = {
  state: SubState; code: string; upiId: string; payeeName: string; plans: Plan[];
  payments: { id: number; plan_name: string; amount: number; utr: string; status: string; created_at: string; note: string }[];
};

export const SUB_TEXT: Record<SubState['status'], string> = {
  free: 'No subscription needed', trial: 'Free trial', active: 'Active', grace: 'Ended: a few days to renew', expired: 'Ended',
};

/** Owner: see the plan, pay by UPI, and send the payment reference for confirmation. */
export default function Subscription() {
  const { data, error, reload } = useLoad(() => api.get<Data>('/subscription'));
  const [pay, setPay] = useState<Plan | null>(null);
  if (!data) return <Loading error={error} />;
  const s = data.state;
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head"><h1>Subscription</h1></div>
      <div className="stack lg">
        <div className="card pad stack">
          <div className="row between wrap">
            <div><div className="small muted">Status</div><b style={{ fontSize: 20 }}>{SUB_TEXT[s.status]}</b></div>
            {s.until && <div style={{ textAlign: 'right' }}><div className="small muted">{s.status === 'trial' ? 'Trial ends' : 'Paid until'}</div><b>{s.until}</b>{s.daysLeft !== null && s.daysLeft >= 0 && <div className="small muted">{s.daysLeft} days left</div>}</div>}
          </div>
          {(s.status === 'grace' || s.status === 'expired') && <div className="err">Renew now. {s.status === 'expired' ? 'New bills are blocked until a payment is confirmed.' : 'Billing stops in a few days.'}</div>}
        </div>

        {s.status !== 'free' && (
          <div className="grid2">
            {data.plans.map((p) => (
              <div key={p.id} className="card pad stack">
                <b>{p.name}</b>
                <div style={{ fontSize: 26, fontWeight: 800 }}>₹{p.price.toLocaleString('en-IN')}</div>
                <div className="small muted">{p.days} days</div>
                <button className="btn primary" onClick={() => setPay(p)}>Pay with UPI</button>
              </div>
            ))}
          </div>
        )}

        {data.payments.length > 0 && (
          <div className="card pad stack">
            <h2>Your payments</h2>
            <div className="table-wrap"><table className="list"><tbody>
              {data.payments.map((p) => (
                <tr key={p.id}><td>{p.created_at.slice(0, 10)}</td><td>{p.plan_name}</td><td className="r">₹{p.amount}</td><td className="small">UTR {p.utr}</td>
                  <td><span className={`pill ${p.status === 'confirmed' ? 'paid' : p.status === 'rejected' ? 'void' : 'unpaid'}`}>{p.status === 'pending' ? 'Being checked' : p.status}</span>{p.note && <div className="small faint">{p.note}</div>}</td></tr>
              ))}
            </tbody></table></div>
          </div>
        )}
      </div>
      {pay && <PayModal plan={pay} data={data} onClose={() => setPay(null)} onDone={() => { setPay(null); reload(); }} />}
    </div>
  );
}

function PayModal({ plan, data, onClose, onDone }: { plan: Plan; data: Data; onClose: () => void; onDone: () => void }) {
  const [utr, setUtr] = useState('');
  const [qr, setQr] = useState('');
  const { run, busy } = useAction();
  const link = data.upiId
    ? `upi://pay?pa=${encodeURIComponent(data.upiId)}&pn=${encodeURIComponent(data.payeeName)}&am=${plan.price}&cu=INR&tn=${encodeURIComponent(`YorMenu ${data.code} ${plan.id}`)}`
    : '';
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 260 }).then(setQr).catch(() => {}); }, [link]);
  const send = () => run(async () => { await api.post('/subscription/payments', { planId: plan.id, utr }); onDone(); }, 'Thanks! We will confirm your payment shortly.');
  return (
    <Modal title={`${plan.name} · ₹${plan.price}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || utr.length < 6} onClick={send}>I have paid</button></>}>
      {!link ? <div className="err">Online payment isn't set up yet. Please call YorMenu support to renew.</div> : (<>
        <ol className="steps">
          <li>Pay <b>₹{plan.price}</b> to <b>{data.upiId}</b> ({data.payeeName}).</li>
          <li>Copy the <b>UPI reference / UTR</b> number from your payment app.</li>
          <li>Enter it below. We confirm it and your plan starts.</li>
        </ol>
        <a className="btn ok block" href={link}>Open UPI app (GPay, PhonePe, Paytm…)</a>
        {qr && <div className="center"><img src={qr} alt="UPI QR code" width={200} height={200} /><div className="small muted">Or scan with any UPI app</div></div>}
      </>)}
      <label>UPI reference (UTR)<input value={utr} onChange={(e) => setUtr(e.target.value.replace(/[^A-Za-z0-9]/g, ''))} placeholder="e.g. 431245678901" inputMode="numeric" /></label>
    </Modal>
  );
}
