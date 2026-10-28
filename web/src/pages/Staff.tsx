import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Loading, Modal, useAction, useLoad } from '../ui';
import { ROLE_LABEL } from '../format';
import type { Role } from '../types';

type StaffRow = { id: number; username: string; name: string; role: Role; phone: string; active: number; created_at: string };
const ALL_ROLES: Role[] = ['owner', 'trustee', 'manager', 'cashier', 'server', 'chef', 'cleaner'];

export default function Staff() {
  const { me, can } = useSession();
  const { data, error, reload } = useLoad(() => api.get<StaffRow[]>('/staff'));
  const [edit, setEdit] = useState<Partial<StaffRow> | null>(null);
  if (!data) return <Loading error={error} />;
  // Same rule as the server: owner manages all, trustee all but owners, manager only floor staff.
  const roles = ALL_ROLES.filter((r) => (me?.user.role === 'owner' ? true : me?.user.role === 'trustee' ? r !== 'owner' : (me?.manages ?? []).includes(r)));
  return (
    <div className="page">
      <div className="page-head">
        <h1>Staff</h1>
        {can('staff.edit') && <button className="btn primary" onClick={() => setEdit({ role: 'server' })}>+ Add staff</button>}
      </div>
      <p className="muted" style={{ marginTop: -6 }}>Each person gets their own login. They sign in with restaurant code <b>{me?.restaurant.code}</b>, their username and password, and only see the screens for their role.</p>
      <div className="card table-wrap">
        <table className="list">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Phone</th><th>Status</th><th /></tr></thead>
          <tbody>{data.map((u) => (
            <tr key={u.id} style={u.active ? undefined : { opacity: .5 }}>
              <td><b>{u.name}</b></td><td className="small">{u.username}</td><td>{ROLE_LABEL[u.role]}</td><td className="small">{u.phone}</td>
              <td>{u.active ? <span className="pill served">Active</span> : <span className="pill">Disabled</span>}</td>
              <td className="r">{can('staff.edit') && roles.includes(u.role) && <button className="btn sm" onClick={() => setEdit(u)}>Edit</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {edit && <StaffModal u={edit} roles={roles} self={edit.id === me?.user.id} onClose={() => setEdit(null)} onSaved={() => { reload(); setEdit(null); }} />}
    </div>
  );
}

function StaffModal({ u, roles, self, onClose, onSaved }: { u: Partial<StaffRow>; roles: Role[]; self: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: u.name ?? '', username: u.username ?? '', role: u.role ?? 'server', phone: u.phone ?? '', password: '', active: u.active !== 0 });
  const { run, busy } = useAction();
  const save = () => run(async () => {
    if (u.id) await api.patch(`/staff/${u.id}`, { name: f.name, role: f.role, phone: f.phone, active: f.active, ...(f.password ? { password: f.password } : {}) });
    else await api.post('/staff', f);
    onSaved();
  }, 'Saved');
  return (
    <Modal title={u.id ? `Edit ${u.name}` : 'Add staff member'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.name || (!u.id && (!f.username || f.password.length < 6))} onClick={save}>Save</button></>}>
      <label>Full name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
      <label>Username<input value={f.username} disabled={!!u.id} autoCapitalize="none" onChange={(e) => setF({ ...f, username: e.target.value })} /></label>
      <label>Role<select value={f.role} disabled={self} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
      <label>Phone<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
      {self
        ? <div className="small muted">To change your own password, tap your name at the top of the screen → <b>Change password</b>.</div>
        : <label>{u.id ? 'New password (leave empty to keep)' : 'Password (min 6 characters)'}<input type="text" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          {u.id && <span className="small muted">They will be logged out on every device and must use the new password.</span>}</label>}
      {u.id && !self && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Active (untick to block login immediately)</label>}
    </Modal>
  );
}
