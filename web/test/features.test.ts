import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from './helpers.js';


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
