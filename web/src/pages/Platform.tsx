import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, tokens } from '../api';
import { Modal, useAction, useLoad } from '../ui';
import { dateTimeOf } from '../format';

type R = { id: number; code: string; name: string; address: string; phone: string; active: number; created_at: string; staff: number; tables: number };

export default function Platform() {
  const [token, setToken] = useState(tokens.platform());
  if (!token) return <PlatformLogin onDone={setToken} />;
  return <Restaurants onLogout={() => { tokens.setPlatform(null); setToken(null); }} />;
}

function PlatformLogin({ onDone }: { onDone: (t: string) => void }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.post<{ token: string }>('/auth/platform/login', { username: u, password: p });
      tokens.setPlatform(r.token);
      onDone(r.token);
    } catch (x: any) { setErr(x.message); }
  };
  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <h1>Platform admin</h1>
        <div className="small muted">Onboard and manage restaurants. You never see their orders or bills.</div>
        <label>Username<input value={u} onChange={(e) => setU(e.target.value)} autoCapitalize="none" /></label>
        <label>Password<input type="password" value={p} onChange={(e) => setP(e.target.value)} /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn primary lg">Sign in</button>
        <Link className="small" to="/login">← Staff login</Link>
      </form>
    </div>
  );
}

function Restaurants({ onLogout }: { onLogout: () => void }) {
  const { data, reload, error } = useLoad(() => api.platform.get<R[]>('/platform/restaurants'));
  const [adding, setAdding] = useState(false);
  const { run } = useAction();
  if (error?.includes('log in')) { onLogout(); }
  return (
    <div className="page">
      <div className="page-head"><h1>Restaurants</h1><button className="btn" onClick={onLogout}>Log out</button><button className="btn primary" onClick={() => setAdding(true)}>+ Restaurant</button></div>
      <div className="card table-wrap">
        <table className="list">
          <thead><tr><th>Code</th><th>Name</th><th>Phone</th><th className="r">Staff</th><th className="r">Tables</th><th>Since</th><th>Status</th><th /></tr></thead>
          <tbody>{(data ?? []).map((r) => (
            <tr key={r.id}>
              <td><b>{r.code}</b></td><td>{r.name}<div className="small faint">{r.address}</div></td><td>{r.phone}</td>
              <td className="r">{r.staff}</td><td className="r">{r.tables}</td><td className="small">{dateTimeOf(r.created_at)}</td>
              <td>{r.active ? <span className="pill served">Active</span> : <span className="pill void">Suspended</span>}</td>
              <td className="r"><button className="btn sm" onClick={() => run(async () => { await api.platform.patch(`/platform/restaurants/${r.id}`, { active: !r.active }); reload(); })}>{r.active ? 'Suspend' : 'Activate'}</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {adding && <AddRestaurant onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

function AddRestaurant({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '', name: '', address: '', phone: '', ownerName: '', ownerUser: 'owner', ownerPass: '' });
  const { run, busy } = useAction();
  const save = () => run(async () => {
    await api.platform.post('/platform/restaurants', { code: f.code, name: f.name, address: f.address, phone: f.phone, owner: { name: f.ownerName, username: f.ownerUser, password: f.ownerPass } });
    onDone();
  }, `Restaurant ${f.code.toUpperCase()} created`);
  return (
    <Modal title="New restaurant" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Create</button></>}>
      <label>Restaurant code (staff type this to log in)<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="e.g. ANNAPURNA" /></label>
      <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label>Address<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
      <label>Phone<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
      <h3>Owner login</h3>
      <label>Owner name<input value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></label>
      <div className="row">
        <label className="grow">Username<input value={f.ownerUser} onChange={(e) => setF({ ...f, ownerUser: e.target.value })} /></label>
        <label className="grow">Password<input value={f.ownerPass} onChange={(e) => setF({ ...f, ownerPass: e.target.value })} /></label>
      </div>
    </Modal>
  );
}
