import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Loading, useAction, useLoad } from '../ui';
import { ROLE_LABEL } from '../format';
import type { Role } from '../types';

type PermDef = { key: string; group: string; label: string; defaults: Role[]; ceiling: Role[] };
type RoleRow = { role: Role; perms: string[]; customised: boolean; editable: boolean };
type Matrix = { permissions: PermDef[]; roles: RoleRow[]; grantable: string[] };

/** Who can do what. Owners always have everything; ceilings are fixed for safety. */
export default function Permissions() {
  const { me, refresh } = useSession();
  const { data, error, reload } = useLoad(() => api.get<Matrix>('/permissions'));
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const { run, busy } = useAction();
  // Phones show one role at a time; the full grid is too wide.
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 820px)').matches);
  const [focus, setFocus] = useState<Role | null>(null);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    if (data) setDraft(Object.fromEntries(data.roles.map((r) => [r.role, new Set(r.perms)])));
  }, [data]);

  const groups = useMemo(() => {
    const m = new Map<string, PermDef[]>();
    for (const p of data?.permissions ?? []) (m.get(p.group) ?? m.set(p.group, []).get(p.group)!).push(p);
    return [...m];
  }, [data]);

  if (!data || !Object.keys(draft).length) return <Loading error={error} />;
  const allRoles = data.roles;
  const picked = focus ?? allRoles.find((r) => r.editable)?.role ?? allRoles[0].role;
  const roles = narrow ? allRoles.filter((r) => r.role === picked) : allRoles;
  const dirty = allRoles.filter((r) => {
    const d = draft[r.role];
    return r.editable && (d.size !== r.perms.length || r.perms.some((p) => !d.has(p)));
  });

  const toggle = (role: Role, perm: string) => setDraft((cur) => {
    const next = new Set(cur[role]);
    if (next.has(perm)) next.delete(perm); else next.add(perm);
    return { ...cur, [role]: next };
  });
  const whyLocked = (r: RoleRow, p: PermDef) => {
    if (r.role === 'owner') return 'Owners can always do everything';
    if (!r.editable) return `You can't change ${ROLE_LABEL[r.role]} permissions`;
    if (!p.ceiling.includes(r.role)) return `Not allowed for ${ROLE_LABEL[r.role]} (safety limit)`;
    if (!data.grantable.includes(p.key)) return "You don't have this permission yourself";
    return '';
  };

  const save = () => run(async () => {
    for (const r of dirty) await api.put(`/permissions/${r.role}`, { perms: [...draft[r.role]] });
    await reload();
    await refresh();
  }, 'Permissions saved. Everyone sees the change right away.');
  const reset = (role: Role) => run(async () => {
    await api.put(`/permissions/${role}`, { perms: [], reset: true });
    await reload();
  }, `${ROLE_LABEL[role]} reset to default`);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Permissions</h1>
        {dirty.length > 0 && <button className="btn" onClick={() => setDraft(Object.fromEntries(allRoles.map((r) => [r.role, new Set(r.perms)])))}>Undo</button>}
        <button className="btn primary" disabled={busy || !dirty.length} onClick={save}>Save changes{dirty.length ? ` (${dirty.length})` : ''}</button>
      </div>
      <div className="callout" style={{ marginBottom: 12 }}>
        <b>Chain of control:</b> Platform admin → Owner → Trustee → Manager → Billing, Server, Kitchen, Cleaning.
        {me?.user.role === 'manager'
          ? ' As manager you can change permissions for floor staff, and only switch on things you can do yourself.'
          : ' Owners always have every permission. Greyed boxes are safety limits (e.g. cleaning crew can never void a bill).'}
        {' '}Changes apply on every phone at once and are recorded in Activity.
      </div>
      {narrow && (
        <label style={{ marginBottom: 10 }}>Show permissions for
          <select value={picked} onChange={(e) => setFocus(e.target.value as Role)}>
            {allRoles.map((r) => <option key={r.role} value={r.role}>{ROLE_LABEL[r.role]}{r.editable ? '' : ' (view only)'}</option>)}
          </select>
        </label>
      )}
      <div className="card table-wrap" style={{ maxHeight: narrow ? undefined : 'calc(100vh - 230px)' }}>
        <table className="matrix">
          <thead>
            <tr>
              <th>What they can do</th>
              {roles.map((r) => (
                <th key={r.role}>
                  {ROLE_LABEL[r.role]}
                  {r.customised && <div className="small faint">custom</div>}
                  {r.editable && r.customised && <div><button className="btn ghost sm" onClick={() => reset(r.role)}>Reset</button></div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, perms]) => (
              <Fragment key={group}>
                <tr className="grp"><td colSpan={roles.length + 1}>{group}</td></tr>
                {perms.map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    {roles.map((r) => {
                      const locked = whyLocked(r, p);
                      const on = draft[r.role].has(p.key);
                      if (r.role === 'owner') return <td key={r.role} title={locked} className="locked">✓</td>;
                      if (!p.ceiling.includes(r.role)) return <td key={r.role} title={locked} className="locked">—</td>;
                      return (
                        <td key={r.role} title={locked || undefined}>
                          <input type="checkbox" checked={on} disabled={!!locked} aria-label={`${ROLE_LABEL[r.role]}: ${p.label}`}
                            onChange={() => toggle(r.role, p.key)} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
