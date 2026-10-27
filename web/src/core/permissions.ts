export const ROLES = ['owner', 'trustee', 'manager', 'cashier', 'server', 'chef', 'cleaner'] as const;
export type Role = (typeof ROLES)[number];

const ADMIN: Role[] = ['owner', 'trustee'];
const MGMT: Role[] = [...ADMIN, 'manager'];
const FRONT: Role[] = [...MGMT, 'cashier'];
const STAFF_ROLES: Role[] = ['cashier', 'server', 'chef', 'cleaner'];

type Def = {
  group: string;
  label: string;
  /** Who has it out of the box. */
  defaults: Role[];
  /** The most it can ever be given to. The owner can never hand it out further than this. */
  ceiling: Role[];
};

const ALL: Role[] = [...ROLES];

/** Every permission, grouped for the matrix screen. Anything not granted is denied. */
export const PERMISSION_DEFS = {
  // Floor & orders
  'floor.view': { group: 'Tables & orders', label: 'See tables and running orders', defaults: [...FRONT, 'server'], ceiling: ALL },
  'order.create': { group: 'Tables & orders', label: 'Open a table / new order', defaults: [...FRONT, 'server'], ceiling: [...FRONT, 'server'] },
  'order.kot': { group: 'Tables & orders', label: 'Send items to kitchen (KOT)', defaults: [...FRONT, 'server'], ceiling: [...FRONT, 'server'] },
  'order.serve': { group: 'Tables & orders', label: 'Mark food as served', defaults: [...FRONT, 'server'], ceiling: [...FRONT, 'server'] },
  'order.complete': { group: 'Tables & orders', label: 'Mark dining complete', defaults: [...FRONT, 'server'], ceiling: [...FRONT, 'server'] },
  'order.move': { group: 'Tables & orders', label: 'Move order to another table', defaults: [...FRONT, 'server'], ceiling: [...FRONT, 'server'] },
  'order.cancelQueuedItem': { group: 'Tables & orders', label: 'Cancel an item not yet cooked', defaults: [...FRONT, 'server'], ceiling: [...FRONT, 'server'] },
  'order.cancelAnyItem': { group: 'Tables & orders', label: 'Cancel an item already cooking/cooked', defaults: MGMT, ceiling: FRONT },
  'order.cancel': { group: 'Tables & orders', label: 'Cancel a whole order', defaults: MGMT, ceiling: FRONT },
  'customer.viewPhone': { group: 'Tables & orders', label: "See customers' phone numbers", defaults: [...FRONT, 'server'], ceiling: [...FRONT, 'server'] },
  'guest.handle': { group: 'Tables & orders', label: 'Accept QR orders / guest calls', defaults: [...FRONT, 'server'], ceiling: [...FRONT, 'server'] },

  // Billing
  'bill.view': { group: 'Billing', label: 'See bills and payments', defaults: FRONT, ceiling: [...FRONT, 'server'] },
  'bill.generate': { group: 'Billing', label: 'Close table & make bill', defaults: FRONT, ceiling: [...FRONT, 'server'] },
  'bill.discount': { group: 'Billing', label: 'Give a discount on a bill', defaults: FRONT, ceiling: FRONT },
  'bill.pay': { group: 'Billing', label: 'Take payment (cash / UPI / card)', defaults: FRONT, ceiling: [...FRONT, 'server'] },
  'bill.reopen': { group: 'Billing', label: 'Reopen a bill to change it', defaults: FRONT, ceiling: FRONT },
  'bill.void': { group: 'Billing', label: 'Void (cancel) a bill', defaults: MGMT, ceiling: FRONT },
  'bill.whatsapp': { group: 'Billing', label: 'Send bill on WhatsApp', defaults: FRONT, ceiling: [...FRONT, 'server'] },
  'bill.print': { group: 'Billing', label: 'Print bill', defaults: FRONT, ceiling: [...FRONT, 'server'] },

  // Kitchen
  'kitchen.view': { group: 'Kitchen', label: 'See kitchen screen (KOTs)', defaults: [...MGMT, 'chef', 'cashier'], ceiling: ALL },
  'kitchen.update': { group: 'Kitchen', label: 'Mark dishes cooking / ready', defaults: [...MGMT, 'chef'], ceiling: [...FRONT, 'chef'] },
  'print.station': { group: 'Kitchen', label: 'Be the print station (counter PC prints KOTs/bills)', defaults: [...MGMT, 'cashier', 'chef'], ceiling: [...FRONT, 'chef'] },
  'menu.availability': { group: 'Kitchen', label: 'Mark dishes sold out', defaults: [...MGMT, 'chef'], ceiling: [...FRONT, 'chef'] },

  // Cleaning
  'cleaning.view': { group: 'Cleaning', label: 'See cleaning list', defaults: [...FRONT, 'server', 'cleaner'], ceiling: ALL },
  'cleaning.request': { group: 'Cleaning', label: 'Ask for a table to be cleaned', defaults: [...FRONT, 'server'], ceiling: ALL },
  'cleaning.done': { group: 'Cleaning', label: 'Mark table cleaned', defaults: [...FRONT, 'server', 'cleaner'], ceiling: ALL },

  // Setup
  'menu.edit': { group: 'Menu & floor setup', label: 'Add / edit dishes and prices', defaults: MGMT, ceiling: [...MGMT, 'chef'] },
  'tables.edit': { group: 'Menu & floor setup', label: 'Add / edit tables and QR codes', defaults: MGMT, ceiling: MGMT },

  // People
  'staff.view': { group: 'Staff & permissions', label: 'See staff list', defaults: MGMT, ceiling: FRONT },
  'staff.edit': { group: 'Staff & permissions', label: 'Add / disable staff, reset passwords', defaults: MGMT, ceiling: MGMT },
  'permissions.edit': { group: 'Staff & permissions', label: 'Change this permission matrix', defaults: MGMT, ceiling: MGMT },

  // Reports
  'reports.view': { group: 'Reports & data', label: 'See sales reports', defaults: MGMT, ceiling: FRONT },
  'reports.export': { group: 'Reports & data', label: 'Download reports (Excel / PDF / CSV)', defaults: MGMT, ceiling: FRONT },
  'reports.schedule': { group: 'Reports & data', label: 'Set up automatic report emails', defaults: ADMIN, ceiling: MGMT },
  'audit.view': { group: 'Reports & data', label: 'See activity log (who did what)', defaults: MGMT, ceiling: MGMT },

  // Restaurant
  'settings.edit': { group: 'Restaurant', label: 'Change settings, tax, printers', defaults: ADMIN, ceiling: MGMT },
  'compliance.manage': { group: 'Restaurant', label: 'Upload licences & certificates (FSSAI etc.)', defaults: MGMT, ceiling: MGMT },
  'support.raise': { group: 'Restaurant', label: 'Contact YorMenu support / raise issues', defaults: MGMT, ceiling: FRONT },
} satisfies Record<string, Def>;

export type Permission = keyof typeof PERMISSION_DEFS;
export const PERMISSIONS = Object.keys(PERMISSION_DEFS) as Permission[];
const isPerm = (p: string): p is Permission => p in PERMISSION_DEFS;

/** Saved per restaurant: the full permission list for each role that was customised. */
export type Overrides = Partial<Record<Role, Permission[]>>;

export function parseOverrides(json: string | null | undefined): Overrides {
  let raw: unknown;
  try { raw = JSON.parse(json || '{}'); } catch { return {}; }
  if (!raw || typeof raw !== 'object') return {};
  const out: Overrides = {};
  for (const role of ROLES) {
    const list = (raw as Record<string, unknown>)[role];
    if (Array.isArray(list)) out[role] = list.filter((p): p is Permission => typeof p === 'string' && isPerm(p));
  }
  return out;
}

export function defaultsFor(role: Role): Permission[] {
  return PERMISSIONS.filter((p) => (PERMISSION_DEFS[p].defaults as Role[]).includes(role));
}

/**
 * What a role may do in one restaurant. Owners always have everything, so a
 * restaurant can never lock itself out. Every other role gets its saved list
 * (or the defaults), clipped to each permission's ceiling.
 */
export function effectivePerms(role: Role, overrides: Overrides = {}): Set<Permission> {
  if (role === 'owner') return new Set(PERMISSIONS);
  const list = overrides[role] ?? defaultsFor(role);
  return new Set(list.filter((p) => (PERMISSION_DEFS[p].ceiling as Role[]).includes(role)));
}

/** Plain role check against defaults. Prefer a session's own permission set. */
export function can(role: Role, perm: Permission, overrides?: Overrides): boolean {
  return effectivePerms(role, overrides).has(perm);
}

export function permissionsFor(role: Role, overrides?: Overrides): Permission[] {
  return [...effectivePerms(role, overrides)];
}

/** Owners/trustees manage everyone; managers manage only floor staff. */
export function canManageRole(actor: Role, target: Role): boolean {
  if (actor === 'owner') return true;
  if (actor === 'trustee') return target !== 'owner';
  if (actor === 'manager') return STAFF_ROLES.includes(target);
  return false;
}

/** Which roles' rows an actor may edit in the matrix (needs permissions.edit too). */
export function editableRoles(actor: Role): Role[] {
  if (actor === 'owner') return ['trustee', 'manager', ...STAFF_ROLES];
  if (actor === 'trustee') return ['manager', ...STAFF_ROLES];
  if (actor === 'manager') return [...STAFF_ROLES];
  return [];
}

/** The matrix as the screen shows it: groups, labels, and who could ever get each one. */
export function matrixMeta() {
  return PERMISSIONS.map((p) => ({ key: p, ...PERMISSION_DEFS[p] }));
}

export { ADMIN, MGMT, FRONT, STAFF_ROLES };

/** The matrix as security rules read it: role → permission list (owners are always allowed everything). */
export function permsMap(overrides: Overrides = {}): Record<Role, Permission[]> {
  return Object.fromEntries(ROLES.map((r) => [r, [...effectivePerms(r, overrides)]])) as Record<Role, Permission[]>;
}
