import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, tokens } from '../api';
import { Loading, Modal, useAction, useLoad } from '../ui';
import { dateTimeOf, ROLE_LABEL } from '../format';
import { Icon } from '../icons';
import { STATE_TEXT } from './Compliance';

const P = api.platform;
type Section = 'dashboard' | 'restaurants' | 'tickets' | 'compliance' | 'activity' | 'settings' | 'account';

export default function Platform() {
  const [token, setToken] = useState(tokens.platform());
  if (!token) return <PlatformLogin onDone={setToken} />;
  return <Console onLogout={() => { tokens.setPlatform(null); setToken(null); void api.post('/auth/logout').catch(() => {}); }} />;
}

function PlatformLogin({ onDone }: { onDone: (t: string) => void }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/auth/platform/login', { username: u, password: p });
      tokens.setPlatform('platform');
      onDone('platform');
    } catch (x: any) { setErr(x.message); }
  };
  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <div className="row"><img src="/icon.svg" width={36} height={36} alt="" /><div><h1>YorMenu platform</h1><div className="muted small">Super admin</div></div></div>
        <div className="small muted">Onboard restaurants, verify licences, answer support. You never see their orders, bills or customers.</div>
        <label>Email<input type="email" value={u} onChange={(e) => setU(e.target.value)} autoCapitalize="none" autoComplete="username" /></label>
        <label>Password<input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn primary lg">Sign in</button>
        <Link className="small" to="/login">← Staff login</Link>
      </form>
    </div>
  );
}

function Console({ onLogout }: { onLogout: () => void }) {
  const [sec, setSec] = useState<Section>('dashboard');
  const [openRest, setOpenRest] = useState<number | null>(null);
  const [openTicket, setOpenTicket] = useState<number | null>(null);
  const dash = useLoad(() => P.get<any>('/platform/dashboard'), [sec]);
  useEffect(() => { if (dash.error?.includes('log in')) onLogout(); }, [dash.error, onLogout]);
  const nav: [Section, string, string, number?][] = [
    ['dashboard', 'Dashboard', 'chart'], ['restaurants', 'Restaurants', 'store'],
    ['tickets', 'Support inbox', 'ticket', dash.data?.openTickets], ['compliance', 'Licence checks', 'badge', dash.data?.docs.pending],
    ['activity', 'Activity log', 'log'], ['settings', 'Support contact', 'phone'], ['account', 'My account', 'users'],
  ];
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand"><img src="/icon.svg" alt="" /><span>YorMenu platform</span></span>
        <span className="grow" />
        <button className="btn ghost sm" onClick={onLogout}><Icon name="logout" />Log out</button>
      </header>
      <div className="page">
        <div className="side-layout">
          <div className="side-nav">
            {nav.map(([k, l, icon, n]) => (
              <button key={k} className={sec === k ? 'on' : ''} onClick={() => setSec(k)}>
                <span className="row"><Icon name={icon} size={18} />{l}</span>{n ? <span className="pill unpaid">{n}</span> : null}
              </button>
            ))}
          </div>
          <div>
            {sec === 'dashboard' && <Dashboard d={dash.data} error={dash.error} onRest={setOpenRest} onTicket={setOpenTicket} go={setSec} />}
            {sec === 'restaurants' && <Restaurants onOpen={setOpenRest} />}
            {sec === 'tickets' && <TicketInbox onOpen={setOpenTicket} />}
            {sec === 'compliance' && <ComplianceQueue onRest={setOpenRest} />}
            {sec === 'activity' && <Activity />}
            {sec === 'settings' && <ContactSettings />}
            {sec === 'account' && <Account />}
          </div>
        </div>
      </div>
      {openRest && <RestaurantDetail id={openRest} onClose={() => { setOpenRest(null); dash.reload(); }} onTicket={setOpenTicket} />}
      {openTicket && <PlatformTicket id={openTicket} onClose={() => { setOpenTicket(null); dash.reload(); }} />}
    </div>
  );
}

function Dashboard({ d, error, onRest, onTicket, go }: { d: any; error: string | null; onRest: (id: number) => void; onTicket: (id: number) => void; go: (s: Section) => void }) {
  if (!d) return <Loading error={error} />;
  const tile = (k: string, v: number | string, onClick?: () => void, warn?: boolean) => (
    <button className="card stat" style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default', borderColor: warn ? 'var(--danger)' : undefined }} onClick={onClick}>
      <div className="k">{k}</div><div className="v">{v}</div>
    </button>
  );
  return (
    <div className="stack lg">
      <h1>Dashboard</h1>
      <div className="kpi-row">
        {tile('Active restaurants', d.restaurants.active, () => go('restaurants'))}
        {tile('Suspended', d.restaurants.suspended, () => go('restaurants'), d.restaurants.suspended > 0)}
        {tile('Active staff logins', d.staff)}
        {tile('Open support issues', d.openTickets, () => go('tickets'), d.urgentTickets > 0)}
        {tile('Licences to verify', d.docs.pending, () => go('compliance'), d.docs.pending > 0)}
        {tile('Licences expired / expiring', `${d.docs.expired} / ${d.docs.expiring}`, () => go('compliance'), d.docs.expired > 0)}
      </div>
      <div className="grid2">
        <div className="card pad stack">
          <h2>Needs attention</h2>
          {d.recentTickets.length ? (
            <table className="list"><tbody>{d.recentTickets.map((k: any) => (
              <tr key={k.id} className="click" onClick={() => onTicket(k.id)}>
                <td><b>{k.subject}</b><div className="small faint">{k.restaurant} ({k.code})</div></td>
                <td><span className={`state-pill ${k.priority}`}>{k.priority}</span></td>
              </tr>
            ))}</tbody></table>
          ) : <div className="faint">No open issues 🎉</div>}
        </div>
        <div className="card pad stack">
          <h2>Not used in 7 days</h2>
          {d.inactive.length ? (
            <table className="list"><tbody>{d.inactive.map((r: any) => (
              <tr key={r.id} className="click" onClick={() => onRest(r.id)}><td><b>{r.name}</b> <span className="faint small">{r.code}</span></td>
                <td className="small r">{r.last_login ? dateTimeOf(r.last_login) : 'never logged in'}</td></tr>
            ))}</tbody></table>
          ) : <div className="faint">Every restaurant is active.</div>}
        </div>
      </div>
    </div>
  );
}

function ComplianceBadge({ c }: { c: Record<string, number> }) {
  if (c.expired || c.rejected) return <span className="state-pill expired">{c.expired + c.rejected} problem</span>;
  if (c.missing) return <span className="state-pill missing">{c.missing} missing</span>;
  if (c.pending) return <span className="state-pill pending">{c.pending} to check</span>;
  if (c.expiring) return <span className="state-pill expiring">{c.expiring} expiring</span>;
  return <span className="state-pill verified">All good</span>;
}

function Restaurants({ onOpen }: { onOpen: (id: number) => void }) {
  const { data, reload, error } = useLoad(() => P.get<any[]>('/platform/restaurants'));
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  if (!data) return <Loading error={error} />;
  const rows = data.filter((r) => !q || `${r.name} ${r.code} ${r.city} ${r.phone}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack">
      <div className="page-head"><h1>Restaurants</h1><input style={{ width: 200 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Restaurant</button></div>
      <div className="card table-wrap">
        <table className="list">
          <thead><tr><th>Restaurant</th><th>Contact</th><th className="r">Staff</th><th>Licences</th><th className="r">Issues</th><th>Last used</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="click" onClick={() => onOpen(r.id)}>
              <td><b>{r.name}</b> <span className="small faint">{r.code}</span><div className="small faint">{[r.city, r.state].filter(Boolean).join(', ') || r.address}</div></td>
              <td className="small">{r.phone}<div className="faint">{r.email}</div></td>
              <td className="r">{r.staff}</td>
              <td><ComplianceBadge c={r.compliance} /></td>
              <td className="r">{r.open_tickets || '—'}</td>
              <td className="small">{r.last_login ? dateTimeOf(r.last_login) : 'never'}</td>
              <td>{r.active ? <span className="pill served">Active</span> : <span className="pill void" title={r.suspend_reason}>Suspended</span>}</td>
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <div className="empty">No restaurants.</div>}
      </div>
      {adding && <AddRestaurant onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

function AddRestaurant({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '', name: '', address: '', city: '', state: '', phone: '', email: '', gstin: '', ownerName: '', ownerUser: 'owner', ownerPass: '', ownerPhone: '', ownerEmail: '' });
  const { run, busy } = useAction();
  const inp = (k: keyof typeof f, label: string, extra: object = {}) => <label>{label}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></label>;
  const save = () => run(async () => {
    await P.post('/platform/restaurants', {
      code: f.code, name: f.name, address: f.address, city: f.city, state: f.state, phone: f.phone, email: f.email, gstin: f.gstin,
      owner: { name: f.ownerName, username: f.ownerUser, password: f.ownerPass, phone: f.ownerPhone, email: f.ownerEmail },
    });
    onDone();
  }, `Restaurant ${f.code.toUpperCase()} created`);
  return (
    <Modal wide title="New restaurant" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Create</button></>}>
      <div className="grid2">
        {inp('code', 'Restaurant code (staff type this to log in)', { placeholder: 'e.g. ANNAPURNA', autoCapitalize: 'characters' })}
        {inp('name', 'Name')}
        {inp('phone', 'Restaurant phone', { inputMode: 'tel' })}
        {inp('email', 'Restaurant email')}
        {inp('city', 'City / town')}
        {inp('state', 'State')}
      </div>
      {inp('address', 'Address')}
      {inp('gstin', 'GSTIN (optional)')}
      <h3>Owner login</h3>
      <div className="grid2">
        {inp('ownerName', 'Owner name')}
        {inp('ownerPhone', 'Owner mobile', { inputMode: 'tel' })}
        {inp('ownerUser', 'Username', { autoCapitalize: 'none' })}
        {inp('ownerPass', 'Temporary password (min 6)')}
      </div>
      {inp('ownerEmail', 'Owner email (for reports)')}
      <div className="small muted">Give the owner the restaurant code, username and password. They should change the password after first login.</div>
    </Modal>
  );
}

function RestaurantDetail({ id, onClose, onTicket }: { id: number; onClose: () => void; onTicket: (id: number) => void }) {
  const { data, error, reload } = useLoad(() => P.get<any>(`/platform/restaurants/${id}`), [id]);
  const [tab, setTab] = useState<'profile' | 'people' | 'licences' | 'support' | 'history'>('profile');
  const [f, setF] = useState<any>(null);
  const [reset, setReset] = useState<any>(null);
  const [suspend, setSuspend] = useState(false);
  const { run, busy } = useAction();
  useEffect(() => { if (data) setF({ name: data.name, address: data.address, city: data.city, state: data.state, phone: data.phone, email: data.email, gstin: data.gstin, plan: data.plan, platformNotes: data.platform_notes }); }, [data]);
  if (!data || !f) return <Modal title="Restaurant" onClose={onClose}><Loading error={error} /></Modal>;
  const inp = (k: string, label: string) => <label>{label}<input value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <Modal wide title={<>{data.name} <span className="faint small">{data.code}</span></>} onClose={onClose}>
      <div className="row wrap">
        {data.active ? <span className="pill served">Active</span> : <span className="pill void">Suspended: {data.suspend_reason}</span>}
        <ComplianceBadge c={data.compliance} />
        <span className="small faint">Since {dateTimeOf(data.created_at)}</span>
        <span className="grow" />
        {data.phone && <a className="btn sm" href={`tel:${data.phone}`}><Icon name="phone" size={14} />Call</a>}
        {data.active
          ? <button className="btn sm danger" onClick={() => setSuspend(true)}>Suspend</button>
          : <button className="btn sm ok" onClick={() => run(async () => { await P.patch(`/platform/restaurants/${id}`, { active: true }); reload(); }, 'Activated')}>Activate</button>}
      </div>
      <div className="tabs">
        {(['profile', 'people', 'licences', 'support', 'history'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ profile: 'Profile', people: 'Owner & managers', licences: 'Licences', support: 'Support', history: 'History' }[t]}</button>
        ))}
      </div>
      {tab === 'profile' && (
        <div className="stack">
          <div className="grid2">{inp('name', 'Name')}{inp('phone', 'Phone')}{inp('email', 'Email')}{inp('gstin', 'GSTIN')}{inp('city', 'City')}{inp('state', 'State')}</div>
          {inp('address', 'Address')}
          <label>Plan<select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}><option value="free">Free</option><option value="basic">Basic</option><option value="pro">Pro</option></select></label>
          <label>Private notes (only platform admins see this)<textarea rows={3} value={f.platformNotes} onChange={(e) => setF({ ...f, platformNotes: e.target.value })} /></label>
          <div className="row"><button className="btn primary" disabled={busy} onClick={() => run(async () => { await P.patch(`/platform/restaurants/${id}`, f); reload(); }, 'Saved')}>Save</button></div>
          <div className="small faint">Staff by role: {data.staffByRole.map((s: any) => `${ROLE_LABEL[s.role]} ${s.n}`).join(' · ') || 'none'}</div>
        </div>
      )}
      {tab === 'people' && (
        <table className="list"><tbody>{data.contacts.map((c: any) => (
          <tr key={c.id}>
            <td><b>{c.name}</b> <span className="small faint">{c.username}</span><div className="small">{ROLE_LABEL[c.role]}{!c.active && ' · disabled'}{c.locked_until && ' · 🔒 locked'}</div></td>
            <td className="small">{c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>}<div className="faint">{c.email}</div></td>
            <td className="small">{c.last_login_at ? `Last login ${dateTimeOf(c.last_login_at)}` : 'Never logged in'}</td>
            <td className="r"><button className="btn sm" onClick={() => setReset(c)}>Reset password</button></td>
          </tr>
        ))}</tbody></table>
      )}
      {tab === 'licences' && <DocsTable docs={data.docs} types={data.docTypes} onChange={reload} />}
      {tab === 'support' && (
        data.tickets.length ? <table className="list"><tbody>{data.tickets.map((k: any) => (
          <tr key={k.id} className="click" onClick={() => onTicket(k.id)}><td><b>#{k.id} {k.subject}</b></td><td><span className={`state-pill ${k.priority}`}>{k.priority}</span></td>
            <td><span className={`state-pill ${k.status}`}>{k.status.replace('_', ' ')}</span></td><td className="small r">{dateTimeOf(k.updated_at)}</td></tr>
        ))}</tbody></table> : <div className="faint">No support issues.</div>
      )}
      {tab === 'history' && (
        <table className="list"><tbody>{data.history.map((h: any, i: number) => (
          <tr key={i}><td className="small">{dateTimeOf(h.created_at)}</td><td><b>{h.action}</b></td><td className="small faint">{h.admin} {h.details !== '{}' && h.details !== '[]' ? h.details : ''}</td></tr>
        ))}</tbody></table>
      )}
      {reset && <ResetLogin rid={id} user={reset} onClose={() => setReset(null)} />}
      {suspend && <SuspendModal rid={id} onClose={() => setSuspend(false)} onDone={() => { setSuspend(false); reload(); }} />}
    </Modal>
  );
}

function SuspendModal({ rid, onClose, onDone }: { rid: number; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  return (
    <Modal title="Suspend restaurant" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button>
      <button className="btn primary" disabled={busy || !reason.trim()} onClick={() => run(async () => { await P.patch(`/platform/restaurants/${rid}`, { active: false, suspendReason: reason }); onDone(); }, 'Suspended')}>Suspend now</button></>}>
      <div className="callout">Everyone in this restaurant is logged out at once and can't log in until you activate it again. Their data stays safe.</div>
      <label>Reason (staff see this when they try to log in)<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Payment pending, FSSAI licence expired" /></label>
    </Modal>
  );
}

function ResetLogin({ rid, user, onClose }: { rid: number; user: any; onClose: () => void }) {
  const [pw, setPw] = useState(() => Math.random().toString(36).slice(2, 10));
  const { run, busy } = useAction();
  return (
    <Modal title={`Reset password for ${user.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || pw.length < 6} onClick={() => run(async () => { await P.post(`/platform/restaurants/${rid}/reset-login`, { userId: user.id, password: pw }); onClose(); }, 'Password reset. Tell the owner on the phone.')}>Reset</button></>}>
      <div className="small muted">Only do this after confirming on the phone that you are talking to {user.name}. They will be logged out everywhere and the restaurant's Activity log records it.</div>
      <label>New temporary password<input value={pw} onChange={(e) => setPw(e.target.value)} /></label>
    </Modal>
  );
}

function DocsTable({ docs, types, onChange }: { docs: any[]; types?: any[]; onChange: () => void }) {
  const [review, setReview] = useState<any>(null);
  const { run } = useAction();
  const label = (k: string) => types?.find((t) => t.key === k)?.label ?? k;
  if (!docs.length) return <div className="faint">No documents uploaded yet.</div>;
  return (
    <>
      <table className="list"><tbody>{docs.map((d) => (
        <tr key={d.id}>
          <td><b>{label(d.doc_type)}</b>{d.restaurant && <div className="small">{d.restaurant} <span className="faint">{d.code}</span></div>}<div className="small faint">No. {d.number || '—'} · valid till {d.expires_on ?? '—'}</div></td>
          <td><span className={`state-pill ${d.state}`}>{STATE_TEXT[d.state]}</span>{d.review_note && <div className="small faint">{d.review_note}</div>}</td>
          <td className="r"><div className="row" style={{ justifyContent: 'flex-end' }}>
            {d.file_name && <button className="btn sm" onClick={() => run(() => P.open(`/platform/compliance/${d.id}/file`))}>View file</button>}
            <button className="btn sm primary" onClick={() => setReview(d)}>Review</button>
          </div></td>
        </tr>
      ))}</tbody></table>
      {review && <ReviewDoc doc={review} label={label(review.doc_type)} onClose={() => setReview(null)} onDone={() => { setReview(null); onChange(); }} />}
    </>
  );
}

function ReviewDoc({ doc, label, onClose, onDone }: { doc: any; label: string; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(doc.review_note ?? '');
  const { run, busy } = useAction();
  const go = (status: string) => run(async () => { await P.post(`/platform/compliance/${doc.id}/review`, { status, note }); onDone(); }, `Marked ${status}`);
  return (
    <Modal title={`Review: ${label}`} onClose={onClose} footer={<>
      <button className="btn" disabled={busy} onClick={() => go('pending')}>Back to pending</button>
      <button className="btn danger" disabled={busy || !note.trim()} onClick={() => go('rejected')}>Reject</button>
      <button className="btn ok" disabled={busy} onClick={() => go('verified')}>Verify ✓</button>
    </>}>
      <div className="small">Number <b>{doc.number || '—'}</b> · issued {doc.issued_on ?? '—'} · valid till <b>{doc.expires_on ?? '—'}</b></div>
      <ol className="steps small">
        <li>Open the file and check the restaurant name and address match.</li>
        <li>For FSSAI, check the number on <a href="https://foscos.fssai.gov.in/" target="_blank" rel="noreferrer">foscos.fssai.gov.in</a>.</li>
        <li>Check the expiry date typed matches the document.</li>
      </ol>
      <label>Note to the restaurant (required to reject)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Photo is blurry, upload a clear one" /></label>
    </Modal>
  );
}

function ComplianceQueue({ onRest }: { onRest: (id: number) => void }) {
  const [state, setState] = useState('pending');
  const { data, error, reload } = useLoad(() => P.get<any[]>(`/platform/compliance?state=${state}`), [state]);
  return (
    <div className="stack">
      <div className="page-head"><h1>Licence checks</h1>
        <div className="segmented">{['pending', 'expiring', 'expired', 'rejected', 'verified', 'all'].map((s) => <button key={s} className={state === s ? 'on' : ''} onClick={() => setState(s)}>{s}</button>)}</div>
      </div>
      {!data ? <Loading error={error} /> : <div className="card pad"><DocsTable docs={data} onChange={reload} /></div>}
      {data && data.length > 0 && <div className="small faint">Tip: click a restaurant in Restaurants to see all its documents. <button className="btn ghost sm" onClick={() => onRest(data[0].restaurant_id)}>Open {data[0].restaurant}</button></div>}
    </div>
  );
}

function TicketInbox({ onOpen }: { onOpen: (id: number) => void }) {
  const [status, setStatus] = useState('active');
  const { data, error } = useLoad(() => P.get<any[]>(`/platform/tickets?status=${status}`), [status]);
  return (
    <div className="stack">
      <div className="page-head"><h1>Support inbox</h1>
        <div className="segmented">{[['active', 'Open'], ['waiting', 'Waiting on restaurant'], ['resolved', 'Resolved'], ['all', 'All']].map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
      </div>
      {!data ? <Loading error={error} /> : (
        <div className="card table-wrap"><table className="list">
          <thead><tr><th>Issue</th><th>Restaurant</th><th>Priority</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>{data.map((k) => (
            <tr key={k.id} className="click" onClick={() => onOpen(k.id)}>
              <td><b>#{k.id} {k.subject}</b><div className="small faint">{k.category} · {k.messages} msgs{k.last_by === 'staff' && ' · awaiting reply'}</div></td>
              <td className="small">{k.restaurant} <span className="faint">{k.code}</span><div className="faint">{k.created_by_name} {k.created_by_phone}</div></td>
              <td><span className={`state-pill ${k.priority}`}>{k.priority}</span></td>
              <td><span className={`state-pill ${k.status}`}>{k.status.replace('_', ' ')}</span></td>
              <td className="small">{dateTimeOf(k.updated_at)}</td>
            </tr>
          ))}</tbody>
        </table>{!data.length && <div className="empty">Nothing here.</div>}</div>
      )}
    </div>
  );
}

function PlatformTicket({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, error, reload } = useLoad(() => P.get<any>(`/platform/tickets/${id}`), [id]);
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('');
  const { run, busy } = useAction();
  return (
    <Modal wide title={data ? `#${data.id} ${data.subject}` : 'Issue'} onClose={onClose} footer={data && <>
      <select style={{ width: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Keep status ({data.status.replace('_', ' ')})</option><option value="in_progress">In progress</option>
        <option value="waiting">Waiting on restaurant</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
      </select>
      <button className="btn" disabled={busy || !status} onClick={() => run(async () => { await P.patch(`/platform/tickets/${id}`, { status }); reload(); setStatus(''); }, 'Updated')}>Set status only</button>
      <button className="btn primary" disabled={busy || !body.trim()} onClick={() => run(async () => { await P.post(`/platform/tickets/${id}/messages`, { body, ...(status ? { status } : {}) }); setBody(''); setStatus(''); reload(); }, 'Reply sent')}>Send reply</button>
    </>}>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="row wrap small">
            <b>{data.restaurant}</b><span className="faint">{data.code}</span>
            <span>· {data.created_by_name} ({ROLE_LABEL[data.created_by_role] ?? ''})</span>
            {data.created_by_phone && <a className="btn sm" href={`tel:${data.created_by_phone}`}><Icon name="phone" size={14} />{data.created_by_phone}</a>}
            <span className={`state-pill ${data.priority}`}>{data.priority}</span><span className={`state-pill ${data.status}`}>{data.status.replace('_', ' ')}</span>
          </div>
          <div className="chat">{data.messages.map((m: any) => (
            <div key={m.id} className={`msg ${m.author_kind === 'platform' ? 'mine' : ''}`}><span className="who">{m.author_name} · {dateTimeOf(m.created_at)}</span>{m.body}</div>
          ))}</div>
          <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply to the restaurant" />
        </>
      )}
    </Modal>
  );
}

function Activity() {
  const { data, error } = useLoad(() => P.get<any[]>('/platform/audit'));
  if (!data) return <Loading error={error} />;
  return (
    <div className="stack">
      <h1>Activity log</h1>
      <div className="card table-wrap"><table className="list">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Restaurant</th><th>Details</th></tr></thead>
        <tbody>{data.map((a) => (
          <tr key={a.id}><td className="small">{dateTimeOf(a.created_at)}</td><td>{a.admin}</td><td><b>{a.action}</b></td><td className="small">{a.restaurant ?? '—'}</td>
            <td className="small faint" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.details}</td></tr>
        ))}</tbody>
      </table>{!data.length && <div className="empty">Nothing yet.</div>}</div>
    </div>
  );
}

function ContactSettings() {
  const { data, error } = useLoad(() => P.get<any>('/platform/settings'));
  const [f, setF] = useState<any>(null);
  const { run, busy } = useAction();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return <Loading error={error} />;
  const inp = (k: string, label: string, extra: object = {}) => <label>{label}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></label>;
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <h1>Support contact</h1>
      <div className="card pad stack">
        <div className="small muted">Shown to every restaurant in Help, in the phone menu, and on the login page (“Forgot password? Call …”).</div>
        <div className="grid2">
          {inp('supportPhone', 'Support phone number', { inputMode: 'tel', placeholder: 'e.g. 9876543210' })}
          {inp('supportWhatsapp', 'Support WhatsApp number', { inputMode: 'tel' })}
          {inp('supportEmail', 'Support email', { type: 'email' })}
          {inp('supportHours', 'Support hours')}
        </div>
        {inp('supportName', 'Support person name')}
        {inp('companyName', 'Company name')}
        <label>Announcement banner (shown at the top of every restaurant's screens; leave empty for none)
          <input value={f.announcement} maxLength={300} onChange={(e) => setF({ ...f, announcement: e.target.value })} placeholder="e.g. Maintenance tonight 2–3 AM" /></label>
        <div className="row"><button className="btn primary" disabled={busy} onClick={() => run(() => P.put('/platform/settings', f), 'Saved. Restaurants see it on their next screen load.')}>Save</button></div>
      </div>
    </div>
  );
}

function Account() {
  const { data, error } = useLoad(() => P.get<any>('/platform/me'));
  const [f, setF] = useState<any>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const { run, busy } = useAction();
  useEffect(() => { if (data) setF({ name: data.name, phone: data.phone, email: data.email }); }, [data]);
  if (!f) return <Loading error={error} />;
  return (
    <div className="stack lg" style={{ maxWidth: 520 }}>
      <h1>My account</h1>
      <div className="card pad stack">
        <div className="small faint">Username: <b>{data.username}</b>{data.last_login_at && ` · last login ${dateTimeOf(data.last_login_at)}`}</div>
        <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Phone<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label>Email (login)<input value={data.email ?? data.username} disabled /></label>
        <div className="row"><button className="btn primary" disabled={busy} onClick={() => run(() => P.put('/platform/me', f), 'Saved')}>Save</button></div>
      </div>
      <div className="card pad stack">
        <h2>Change password</h2>
        <label>Current password<input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
        <label>New password (min 10)<input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
        <div className="row"><button className="btn primary" disabled={busy || pw.next.length < 10} onClick={() => run(async () => {
          await P.post('/platform/me/password', pw);
          tokens.setPlatform(null);
          window.location.reload();
        }, 'Password changed. Log in again.')}>Change password</button></div>
      </div>
      <Admins />
    </div>
  );
}

function Admins() {
  const { data, error, reload } = useLoad(() => P.get<any[]>('/platform/admins'));
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const { run, busy } = useAction();
  if (!data) return <Loading error={error} />;
  return (
    <div className="card pad stack">
      <h2>Platform admins</h2>
      <table className="list"><tbody>{data.map((a) => (
        <tr key={a.id}>
          <td><b>{a.name}</b><div className="small faint">{a.email}</div></td>
          <td className="small">{a.last_login_at ? `Last login ${dateTimeOf(a.last_login_at)}` : 'Never logged in'}</td>
          <td className="r">{a.active ? <button className="btn sm" onClick={() => run(async () => { await P.patch(`/platform/admins/${a.id}`, { active: false }); reload(); }, 'Disabled')}>Disable</button>
            : <button className="btn sm" onClick={() => run(async () => { await P.patch(`/platform/admins/${a.id}`, { active: true }); reload(); }, 'Enabled')}>Enable</button>}</td>
        </tr>
      ))}</tbody></table>
      <h3>Add an admin</h3>
      <div className="grid2">
        <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>Phone<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label>Temporary password (min 10)<input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
      </div>
      <div className="row"><button className="btn primary" disabled={busy || !f.name || !f.email || f.password.length < 10}
        onClick={() => run(async () => { await P.post('/platform/admins', f); setF({ name: '', email: '', phone: '', password: '' }); reload(); }, 'Admin added')}>Add admin</button></div>
    </div>
  );
}
