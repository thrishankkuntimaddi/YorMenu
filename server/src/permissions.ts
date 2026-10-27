export const ROLES = ['owner', 'trustee', 'manager', 'cashier', 'server', 'chef', 'cleaner'] as const;
export type Role = (typeof ROLES)[number];

const ADMIN: Role[] = ['owner', 'trustee'];
const MGMT: Role[] = [...ADMIN, 'manager'];
const FRONT: Role[] = [...MGMT, 'cashier'];

/** Who may do what. Anything not listed is denied. */
export const PERMISSIONS = {
  'floor.view': [...FRONT, 'server'],
  'order.create': [...FRONT, 'server'],
  'order.kot': [...FRONT, 'server'],
  'order.serve': [...FRONT, 'server'],
  'order.complete': [...FRONT, 'server'],
  'order.cancelQueuedItem': [...FRONT, 'server'],
  'order.cancelAnyItem': MGMT,
  'order.cancel': MGMT,
  'order.move': [...FRONT, 'server'],
  'bill.generate': FRONT,
  'bill.reopen': FRONT,
  'bill.pay': FRONT,
  'bill.view': FRONT,
  'bill.void': MGMT,
  'kitchen.view': [...MGMT, 'chef', 'cashier'],
  'kitchen.update': [...MGMT, 'chef'],
  'cleaning.view': [...FRONT, 'server', 'cleaner'],
  'cleaning.request': [...FRONT, 'server'],
  'cleaning.done': [...FRONT, 'server', 'cleaner'],
  'guest.handle': [...FRONT, 'server'],
  'menu.edit': MGMT,
  'menu.availability': [...MGMT, 'chef'],
  'tables.edit': MGMT,
  'staff.view': MGMT,
  'staff.edit': MGMT,
  'settings.edit': ADMIN,
  'reports.view': MGMT,
  'audit.view': MGMT,
} satisfies Record<string, Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, perm: Permission): boolean {
  return (PERMISSIONS[perm] as Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}

/** Managers can't create or edit owners/trustees. */
export function canManageRole(actor: Role, target: Role): boolean {
  if (ADMIN.includes(actor)) return true;
  if (actor === 'manager') return !MGMT.includes(target);
  return false;
}
