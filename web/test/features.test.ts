import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from './helpers.js';
import { doc, updateDoc } from 'firebase/firestore';


let env: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { env = await setup(); });

const platformLogin = () => env.platformLogin();

async function paidBill(owner: Awaited<ReturnType<typeof env.login>>, phone = '9876543210') {
  const o = await owner.post('/api/orders', { type: 'dine_in', tableId: env.tableId(env.a.rid, 'Hut1'), customerPhone: phone });
  await owner.post(`/api/orders/${o.body.id}/kot`, { items: [{ menuItemId: env.itemId(env.a.rid, 'Water Bottle'), qty: 2 }] });
  const billed = await owner.post(`/api/orders/${o.body.id}/bill`, {});
  await owner.post(`/api/bills/${billed.body.bill.id}/pay`, { payments: [{ method: 'cash', amount: billed.body.bill.grand_total }] });
  return { orderId: o.body.id as number, billId: billed.body.bill.id as number };
}

describe('permission matrix', () => {
  it('owner can take a permission away from servers and it applies at once', async () => {
    const owner = await env.login('AAA', 'owner', 'owner123');
    const server = await env.login('AAA', 'server1', 'server123');
    expect((await server.get('/api/floor')).status).toBe(200);

    const m = await owner.get('/api/permissions');
    const serverRow = m.body.roles.find((r: any) => r.role === 'server');
    const perms = serverRow.perms.filter((p: string) => p !== 'floor.view');
    expect((await owner.put('/api/permissions/server', { perms })).status).toBe(200);

    expect((await server.get('/api/floor')).status).toBe(403);
    const me = await server.get('/api/me');
    expect(me.body.permissions).not.toContain('floor.view');
  });

  it('owner always keeps every permission and owner row is not editable', async () => {
    const owner = await env.login('AAA', 'owner', 'owner123');
    expect((await owner.put('/api/permissions/owner', { perms: [] })).status).toBe(403);
    const me = await owner.get('/api/me');
    expect(me.body.permissions).toContain('settings.edit');
    expect(me.body.permissions).toContain('permissions.edit');
  });

  it('ceilings cannot be broken: a cleaner can never void bills', async () => {
    const owner = await env.login('AAA', 'owner', 'owner123');
    const res = await owner.put('/api/permissions/cleaner', { perms: ['bill.void', 'cleaning.view', 'cleaning.done'] });
    expect(res.body.perms).not.toContain('bill.void');
    expect(res.body.perms).toContain('cleaning.done');
  });

  it('a manager cannot edit managers or owners, nor grant what they do not have', async () => {
    const owner = await env.login('AAA', 'owner', 'owner123');
    const manager = await env.login('AAA', 'manager', 'manager123');
    expect((await manager.put('/api/permissions/manager', { perms: [] })).status).toBe(403);
    expect((await manager.put('/api/permissions/trustee', { perms: [] })).status).toBe(403);

    // Owner removes bill.void from the manager; manager then tries to give it to the cashier.
    const mgr = (await owner.get('/api/permissions')).body.roles.find((r: any) => r.role === 'manager');
    await owner.put('/api/permissions/manager', { perms: mgr.perms.filter((p: string) => p !== 'bill.void') });
    const cash = (await manager.get('/api/permissions')).body.roles.find((r: any) => r.role === 'cashier');
    const res = await manager.put('/api/permissions/cashier', { perms: [...cash.perms, 'bill.void', 'permissions.edit'] });
    expect(res.status).toBe(200);
    expect(res.body.perms).not.toContain('bill.void');
    expect(res.body.perms).not.toContain('permissions.edit');
  });

  it('servers cannot see the matrix', async () => {
    const server = await env.login('AAA', 'server1', 'server123');
    expect((await server.get('/api/permissions')).status).toBe(403);
  });

  it('changes are written to the activity log and are per restaurant', async () => {
    const ownerA = await env.login('AAA', 'owner', 'owner123');
    await ownerA.put('/api/permissions/chef', { perms: ['kitchen.view'] });
    const audit = await ownerA.get('/api/audit');
    expect(audit.body.some((a: any) => a.action === 'permissions.update')).toBe(true);
    const chefB = await env.login('BBB', 'chef', 'chef123');
    expect((await chefB.get('/api/me')).body.permissions).toContain('kitchen.update');
  });

  it('discount needs its own permission', async () => {
    const owner = await env.login('AAA', 'owner', 'owner123');
    const cashier = await env.login('AAA', 'biller', 'biller123');
    const row = (await owner.get('/api/permissions')).body.roles.find((r: any) => r.role === 'cashier');
    await owner.put('/api/permissions/cashier', { perms: row.perms.filter((p: string) => p !== 'bill.discount') });
    const o = await owner.post('/api/orders', { type: 'takeaway' });
    await owner.post(`/api/orders/${o.body.id}/kot`, { items: [{ menuItemId: env.itemId(env.a.rid, 'Coke'), qty: 1 }] });
    expect((await cashier.post(`/api/orders/${o.body.id}/bill`, { discount: { type: 'percent', value: 10 } })).status).toBe(403);
    expect((await cashier.post(`/api/orders/${o.body.id}/bill`, {})).status).toBe(200);
  });
});

describe('privacy', () => {
  it('hides customer phone numbers from roles without permission', async () => {
    const owner = await env.login('AAA', 'owner', 'owner123');
    const { orderId } = await paidBill(owner);
    const row = (await owner.get('/api/permissions')).body.roles.find((r: any) => r.role === 'cashier');
    await owner.put('/api/permissions/cashier', { perms: row.perms.filter((p: string) => p !== 'customer.viewPhone') });
    const cashier = await env.login('AAA', 'biller', 'biller123');
    const detail = await cashier.get(`/api/orders/${orderId}`);
    expect(detail.body.customer_phone).toBe('98••••••10');
    const bills = await cashier.get('/api/bills');
    expect(bills.body[0].customer_phone).toBe('98••••••10');
    expect((await owner.get(`/api/orders/${orderId}`)).body.customer_phone).toBe('9876543210');
  });

  it('platform admin never gets order or bill data and only sees management contacts', async () => {
    const p = await platformLogin();
    const d = await p.get(`/api/platform/restaurants/${env.a.rid}`);
    expect(d.status).toBe(200);
    expect(d.body.contacts.every((c: any) => ['owner', 'trustee', 'manager'].includes(c.role))).toBe(true);
    expect(JSON.stringify(d.body)).not.toMatch(/grand_total|bill_no|customer_phone/);
    // A platform login can't open restaurant screens, and Firestore refuses its reads of orders.
    expect((await p.get('/api/bills')).status).toBe(401);
    const { getDocs, collection } = await import('firebase/firestore');
    await expect(getDocs(collection(p.db, `restaurants/${env.a.rid}/orders`))).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('support tickets', () => {
  it('owner raises an issue, platform replies, other restaurants cannot see it', async () => {
    const owner = await env.login('AAA', 'owner', 'owner123');
    const k = await owner.post('/api/support/tickets', { category: 'printer', priority: 'high', subject: 'KOT printer not printing', message: 'Nothing comes out' });
    expect(k.status).toBe(201);

    const ownerB = await env.login('BBB', 'owner', 'owner123');
    expect((await ownerB.get(`/api/support/tickets/${k.body.id}`)).status).toBe(404);
    expect((await ownerB.get('/api/support/tickets')).body).toHaveLength(0);

    const server = await env.login('AAA', 'server1', 'server123');
    expect((await server.post('/api/support/tickets', { category: 'other', subject: 'hello', message: 'hello' })).status).toBe(403);

    const p = await platformLogin();
    const list = await p.get('/api/platform/tickets');
    expect(list.body[0].subject).toBe('KOT printer not printing');
    await p.post(`/api/platform/tickets/${k.body.id}/messages`, { body: 'Check the IP in Settings' });
    const t = await owner.get(`/api/support/tickets/${k.body.id}`);
    expect(t.body.status).toBe('in_progress');
    expect(t.body.messages.at(-1).author_kind).toBe('platform');
  });

  it('support contact set by platform shows for staff and on the login page', async () => {
    const p = await platformLogin();
    await p.put('/api/platform/settings', {
      supportPhone: '9000000001', supportWhatsapp: '9000000001', supportEmail: 'help@yormenu.in', supportHours: '24x7', companyName: 'YorMenu', announcement: '',
    });
    expect((await env.anon.get('/api/public/support')).body.supportPhone).toBe('9000000001');
    const owner = await env.login('AAA', 'owner', 'owner123');
    expect((await owner.get('/api/me')).body.support.supportPhone).toBe('9000000001');
  });
});

describe('licences', () => {
  it('owner adds a licence, platform verifies, other restaurants cannot see it', async () => {
    const owner = await env.login('AAA', 'owner', 'owner123');
    const up = await owner.post('/api/compliance', { docType: 'fssai', number: '12345678901234', expiresOn: '2030-01-01' });
    expect(up.status).toBe(201);
    expect((await owner.get('/api/compliance')).body.docs[0].state).toBe('pending');
    const ownerB = await env.login('BBB', 'owner', 'owner123');
    expect((await ownerB.get('/api/compliance')).body.docs).toHaveLength(0);
    const p = await platformLogin();
    expect((await p.post(`/api/platform/compliance/${up.body.id}/review`, { status: 'rejected' })).status).toBe(400);
    await p.post(`/api/platform/compliance/${up.body.id}/review`, { status: 'verified' });
    expect((await owner.get('/api/compliance')).body.docs[0].state).toBe('verified');
  });
});

describe('report exports', () => {
  it('downloads Excel and CSV for a period', async () => {
    const owner = await env.login('AAA', 'owner', 'owner123');
    await paidBill(owner);
    for (const [fmt, ext] of [['xlsx', '.xlsx'], ['csv', '.csv']]) {
      const res = await owner.get(`/api/reports/export?period=month&format=${fmt}`);
      expect(res.status).toBe(200);
      expect(res.file?.filename.endsWith(ext)).toBe(true);
      expect(res.file!.blob.size).toBeGreaterThan(100);
    }
  });

  it('servers cannot export, and export permission is separate from viewing', async () => {
    const server = await env.login('AAA', 'server1', 'server123');
    expect((await server.get('/api/reports/export?format=xlsx')).status).toBe(403);
    const owner = await env.login('AAA', 'owner', 'owner123');
    const mgr = (await owner.get('/api/permissions')).body.roles.find((r: any) => r.role === 'manager');
    await owner.put('/api/permissions/manager', { perms: mgr.perms.filter((p: string) => p !== 'reports.export') });
    const manager = await env.login('AAA', 'manager', 'manager123');
    expect((await manager.get('/api/reports/summary')).status).toBe(200);
    expect((await manager.get('/api/reports/export?format=xlsx')).status).toBe(403);
    expect((await manager.get('/api/reports/items?format=csv')).status).toBe(403);
  });

  it('WhatsApp summary link for the owner', async () => {
    const owner = await env.login('AAA', 'owner', 'owner123');
    await paidBill(owner);
    const out = await owner.post('/api/reports/send', { period: 'day', whatsappTo: '9876543210' });
    expect(out.status).toBe(201);
    expect(out.body.whatsappUrl).toContain('wa.me/919876543210');
    expect(out.body.summary.bills).toBe(1);
  });
});

describe('platform support mode, restaurant codes, GST', () => {
  it('the system makes a strong restaurant code when none is given', async () => {
    const p = await platformLogin();
    const r = await p.post('/api/platform/restaurants', {
      name: 'New Place', owner: { name: 'Sita', username: 'owner', password: 'owner123' },
    });
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^[A-HJ-KM-NP-Z2-9]{5}$/);
    expect(r.body.code).toMatch(/\d/);
    expect(r.body.code).toMatch(/[A-Z]/);
    const owner = await env.login(r.body.code, 'owner', 'owner123');
    expect((await owner.get('/api/me')).body.restaurant.code).toBe(r.body.code);
  });

  it('a platform admin can set up menu, tables and staff for a restaurant, but never see orders or bills', async () => {
    const p = await platformLogin();
    const rid = env.a.rid;
    const cat = (await p.get(`/api/platform/act/${rid}/catalog`)).body;
    expect(cat.items.length).toBeGreaterThan(0);
    const item = await p.post(`/api/platform/act/${rid}/menu/items`, { categoryId: cat.categories[0].id, name: 'Support Special', price: 12000 });
    expect(item.status).toBe(201);
    const sec = cat.sections[0].id;
    expect((await p.post(`/api/platform/act/${rid}/tables`, { sectionId: sec, labels: ['S1'] })).status).toBe(201);
    expect((await p.post(`/api/platform/act/${rid}/staff`, { name: 'New Server', username: 'server77', role: 'server', password: 'server123' })).status).toBe(201);
    // The restaurant sees the changes.
    const owner = await env.login('AAA', 'owner', 'owner123');
    const after = (await owner.get('/api/catalog')).body;
    expect(after.items.some((i: any) => i.name === 'Support Special')).toBe(true);
    expect(after.tables.some((t: any) => t.label === 'S1')).toBe(true);
    await env.login('AAA', 'server77', 'server123');
    // Nothing else is reachable.
    expect((await p.get(`/api/platform/act/${rid}/floor`)).status).toBe(403);
    expect((await p.get(`/api/platform/act/${rid}/bills`)).status).toBe(403);
    expect((await p.put(`/api/platform/act/${rid}/settings`, {})).status).toBe(403);
    // Staff can't use support mode.
    expect((await owner.get(`/api/platform/act/${rid}/catalog`)).status).toBe(401);
  });

  it('GST: tax invoice heading, GST on service charge, GSTIN checked, composition bill of supply', async () => {
    const owner = await env.login('AAA', 'owner', 'owner123');
    const cur = (await owner.get('/api/settings')).body;
    const save = (gstin: string, settings: object) => owner.put('/api/settings', { name: cur.name, address: cur.address, phone: cur.phone, gstin, settings: { ...cur.settings, ...settings } });
    expect((await save('', { gstType: 'regular5' })).status).toBe(400);
    expect((await save('NOT-A-GSTIN', { gstType: 'regular5' })).status).toBe(400);
    expect((await save('37abcde1234f1z5', { gstType: 'regular5', taxMode: 'exclusive', taxes: [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }], serviceChargePct: 10, roundOff: false })).status).toBe(200);

    const o = await owner.post('/api/orders', { type: 'dine_in', tableId: env.tableId(env.a.rid, 'Hut1') });
    await owner.post(`/api/orders/${o.body.id}/kot`, { items: [{ menuItemId: env.itemId(env.a.rid, 'Water Bottle'), qty: 5 }] });
    const billed = (await owner.post(`/api/orders/${o.body.id}/bill`, { force: true })).body;
    const b = billed.bill;
    // ₹20 × 5 = ₹100; service charge ₹10; GST 5% on ₹110 = ₹5.50 → ₹115.50
    expect(b.service_charge).toBe(1000);
    expect(b.tax_total).toBe(550);
    expect(b.grand_total).toBe(11550);
    const ticket = (await owner.get(`/api/bills/${b.id}/ticket`)).body;
    expect(ticket.gstin).toBe('37ABCDE1234F1Z5');
    expect(ticket.docTitle).toBe('TAX INVOICE');

    expect((await save('37ABCDE1234F1Z5', { gstType: 'composition', taxMode: 'none', taxes: [], serviceChargePct: 0 })).status).toBe(200);
    await owner.post(`/api/orders/${o.body.id}/reopen`);
    const again = (await owner.post(`/api/orders/${o.body.id}/bill`, { force: true })).body.bill;
    expect(again.tax_total).toBe(0);
    const t2 = (await owner.get(`/api/bills/${again.id}/ticket`)).body;
    expect(t2.docTitle).toBe('BILL OF SUPPLY');
    expect(t2.taxNote).toContain('Composition taxable person');
  });
});

describe('self sign-up, quick billing, subscription', () => {
  const PHOTO = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const form = {
    businessType: 'counter', businessName: 'Ravi Tiffins', ownerName: 'Ravi', mobile: '9876500000', email: '',
    address: 'Bus stand road', city: 'Dharmavaram', state: 'Andhra Pradesh', gstin: '', fssai: '12345678901234',
    username: 'ravi', password: 'ravi1234',
    files: [{ kind: 'fssai', name: 'fssai.jpg', type: 'image/jpeg', data: PHOTO }],
  };

  it('a stall registers, gets approved, bills from a phone, and must renew after the trial', async () => {
    const { device } = await import('./helpers.js');
    const phone = device();
    expect((await phone.post('/api/public/register', { ...form, files: [] })).status).toBe(400);
    expect((await phone.post('/api/public/register', form)).status).toBe(201);
    expect((await phone.get('/api/public/register/status')).body.status).toBe('pending');

    const p = await platformLogin();
    const list = (await p.get('/api/platform/signups')).body;
    expect(list[0].businessName).toBe('Ravi Tiffins');
    const detail = (await p.get(`/api/platform/signups/${list[0].uid}`)).body;
    expect(detail.files[0].data).toBe(PHOTO);
    expect(JSON.stringify(detail)).not.toContain('ravi1234');
    const made = (await p.post(`/api/platform/signups/${list[0].uid}/approve`)).body;
    expect(made.code).toMatch(/^[A-Z2-9]{5}$/);
    expect((await phone.get('/api/public/register/status')).body).toMatchObject({ status: 'approved', code: made.code });

    // The owner logs in with the new code and the password they chose.
    const owner = await env.login(made.code, 'ravi', 'ravi1234');
    const me = (await owner.get('/api/me')).body;
    expect(me.restaurant.settings.businessMode).toBe('counter');
    expect(me.subscription.status).toBe('trial');

    // Quick billing: add an item, bill it, paid by UPI in one step.
    const cat = (await owner.get('/api/catalog')).body;
    const catId = (await owner.post('/api/menu/categories', { name: 'Tiffins' })).body.id ?? (await owner.get('/api/catalog')).body.categories[0].id;
    const item = (await owner.post('/api/menu/items', { categoryId: catId ?? cat.categories[0]?.id, name: 'Idli', price: 4000, sendToKitchen: false })).body;
    let bill = await owner.post('/api/quick-bill', { items: [{ menuItemId: item.id, qty: 2 }], method: 'upi', customerPhone: '9000011111' });
    expect(bill.status).toBe(201);
    expect(bill.body.bill.status).toBe('paid');
    expect(bill.body.bill.grand_total).toBe(8000);
    expect(bill.body.bill.payments[0].method).toBe('upi');

    // Trial over (and grace over): new bills are blocked.
    await updateDoc(doc(p.db, `restaurants/${made.id}`), { trial_ends: '2020-01-01' });
    expect((await owner.get('/api/me')).body.subscription.status).toBe('expired');
    bill = await owner.post('/api/quick-bill', { items: [{ menuItemId: item.id, qty: 1 }], method: 'cash' });
    expect(bill.status).toBe(402);

    // Owner pays by UPI and sends the reference; platform confirms; billing works again.
    const sub = (await owner.get('/api/subscription')).body;
    expect(sub.plans.every((pl: any) => pl.for !== 'restaurant')).toBe(true);
    expect((await owner.post('/api/subscription/payments', { planId: sub.plans[0].id, utr: '431245678901' })).status).toBe(201);
    expect((await owner.post('/api/subscription/payments', { planId: sub.plans[0].id, utr: '431245678901' })).status).toBe(409);
    // Staff can't extend their own subscription.
    await expect(updateDoc(doc(owner.db, `restaurants/${made.id}`), { paid_until: '2099-01-01' })).rejects.toMatchObject({ code: 'permission-denied' });
    const pays = (await p.get('/api/platform/payments')).body;
    expect((await p.post(`/api/platform/payments/${pays[0].id}/confirm`)).status).toBe(200);
    expect((await owner.get('/api/me')).body.subscription.status).toBe('active');
    expect((await owner.post('/api/quick-bill', { items: [{ menuItemId: item.id, qty: 1 }], method: 'cash' })).status).toBe(201);

    // Old restaurants (made before subscriptions) are never blocked.
    const a = await env.login('AAA', 'owner', 'owner123');
    expect((await a.get('/api/me')).body.subscription.status).toBe('free');
  });
});

describe('activity log and own account', () => {
  it('activity lines name the table and the staff member instead of ids', async () => {
    const s = await setup();
    const owner = await s.login('AAA', 'owner', 'owner123');
    const order = await owner.post('/api/orders', { type: 'dine_in', tableId: s.tableId(s.a.rid, 'Hut3') });
    expect(order.status).toBe(201);
    await owner.post(`/api/orders/${order.body.id}/kot`, { items: [{ menuItemId: s.itemId(s.a.rid, 'Paneer 65'), qty: 2 }] });
    await owner.patch(`/api/staff/${s.a.users.server2}`, { phone: '9000000000' });
    const rows = (await owner.get('/api/audit')).body;
    expect(rows.find((a: any) => a.action === 'order.create').where).toBe('Table Hut3');
    expect(rows.find((a: any) => a.action === 'kot.create').where).toBe('Table Hut3');
    expect(rows.find((a: any) => a.action === 'staff.update').person).toBe('Kiran');
  });

  it('anyone can change their own password with the current one', async () => {
    const s = await setup();
    const server = await s.login('AAA', 'server1', 'server123');
    expect((await server.post('/api/auth/change-password', { current: 'wrong-one', next: 'newpass1' })).status).toBe(400);
    expect((await server.post('/api/auth/change-password', { current: 'server123', next: 'newpass1' })).status).toBe(200);
    await expect(s.login('AAA', 'server1', 'server123')).rejects.toThrow();
    const again = await s.login('AAA', 'server1', 'newpass1');
    expect((await again.get('/api/floor')).status).toBe(200);
    const owner = await s.login('AAA', 'owner', 'owner123');
    expect((await owner.get('/api/audit')).body.some((a: any) => a.action === 'password.change')).toBe(true);
  });
});
