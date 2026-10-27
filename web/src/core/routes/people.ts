import { Router } from '../http.js';
import { z } from 'zod';
import type { AppDeps } from '../index.js';
import { forbidden } from '../errors.js';
import { requirePerm } from '../session.js';
import {
  PERMISSION_DEFS, PERMISSIONS, Permission, ROLES, Role, defaultsFor, editableRoles, effectivePerms, matrixMeta, parseOverrides, permsMap,
} from '../permissions.js';
import { parse } from '../validate.js';

/** The permission matrix: who may do what in this restaurant. */
export function peopleRoutes({ rt }: AppDeps) {
  const r = new Router();

  r.get('/permissions', requirePerm('permissions.edit'), async (req, res) => {
    const s = req.staff!;
    const overrides = parseOverrides((await s.tenant.restaurant()).permissions);
    res.json({
      permissions: matrixMeta(),
      roles: ROLES.map((role) => ({
        role,
        perms: [...effectivePerms(role, overrides)],
        customised: !!overrides[role],
        editable: editableRoles(s.role).includes(role),
      })),
      // Non-owners can only switch on/off what they hold themselves.
      grantable: s.role === 'owner' ? PERMISSIONS : [...s.perms],
    });
  });

  r.put('/permissions/:role', requirePerm('permissions.edit'), async (req, res) => {
    const s = req.staff!;
    const t = s.tenant;
    const role = parse(z.enum(ROLES), req.params.role) as Role;
    if (!editableRoles(s.role).includes(role)) throw forbidden(`You can't change permissions for this role`);
    const b = parse(z.object({ perms: z.array(z.string()).max(PERMISSIONS.length), reset: z.boolean().optional() }), req.body);

    const overrides = parseOverrides((await t.restaurant()).permissions);
    const before = effectivePerms(role, overrides);
    const wanted = b.reset ? new Set(defaultsFor(role)) : new Set(b.perms.filter((p): p is Permission => p in PERMISSION_DEFS));

    const next = new Set<Permission>();
    for (const p of PERMISSIONS) {
      const mayTouch = s.role === 'owner' || s.perms.has(p);
      const on = mayTouch ? wanted.has(p) : before.has(p);
      // Ceilings are hard limits, whatever is sent.
      if (on && (PERMISSION_DEFS[p].ceiling as Role[]).includes(role)) next.add(p);
    }
    // A manager editing staff can never hand out the matrix itself to someone below.
    if (s.role === 'manager') next.delete('permissions.edit');

    overrides[role] = [...next];
    await t.updateRestaurant({ permissions: JSON.stringify(overrides), perms: permsMap(overrides) });
    const added = [...next].filter((p) => !before.has(p));
    const removed = [...before].filter((p) => !next.has(p));
    await t.audit(s.userId, b.reset ? 'permissions.reset' : 'permissions.update', 'role', null, { role, added, removed });
    rt.emit(s.rid, 'permissions:changed', { role });
    res.json({ role, perms: [...next], added, removed });
  });

  /** Personal preferences anyone can set for themselves. */
  r.patch('/me/prefs', async (req, res) => {
    const s = req.staff!;
    const b = parse(z.object({ lang: z.enum(['', 'en', 'te', 'hi']).optional() }), req.body);
    if (b.lang !== undefined) await s.tenant.update('users', s.userId, { lang: b.lang });
    res.json({ ok: true });
  });

  return r;
}
