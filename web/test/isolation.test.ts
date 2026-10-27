import { describe, it, expect } from 'vitest';
import { setup } from './helpers.js';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

describe('tenant isolation', () => {
  it('staff of restaurant B cannot see or touch anything of restaurant A', async () => {
    const s = await setup();
    const aServer = await s.login('AAA', 'server1', 'server123');
    const bOwner = await s.login('BBB', 'owner', 'owner123');
    const bServer = await s.login('BBB', 'server1', 'server123');

    const aTable = s.tableId(s.a.rid, 'Hut1');
    const aItem = s.itemId(s.a.rid, 'Butter Naan');
    const order = (await aServer.post('/api/orders', { type: 'dine_in', tableId: aTable })).body;
    const withKot = (await aServer.post(`/api/orders/${order.id}/kot`, { items: [{ menuItemId: aItem, qty: 1 }] })).body;
    const aItemRow = withKot.items[0];
    const aKot = withKot.kots[0];

    // Reading A's things by id from B: always 404, never data.
    for (const url of [`/api/orders/${order.id}`, `/api/kots/${aKot.id}/ticket`]) {
      expect((await bOwner.get(url)).status).toBe(404);
    }
    // Writing to A's things from B.
    expect((await bServer.post(`/api/orders/${order.id}/kot`, { items: [{ menuItemId: s.itemId(s.b.rid, 'Coke'), qty: 1 }] })).status).toBe(404);
    expect((await bOwner.post(`/api/items/${aItemRow.id}/status`, { status: 'ready' })).status).toBe(404);
    expect((await bOwner.post(`/api/items/${aItemRow.id}/cancel`, { reason: 'x' })).status).toBe(404);
    expect((await bOwner.post(`/api/orders/${order.id}/bill`, {})).status).toBe(404);
    expect((await bOwner.patch(`/api/menu/items/${aItem}`, { price: 1 })).status).toBe(404);
    expect((await bOwner.patch(`/api/tables/${aTable}`, { label: 'pwned' })).status).toBe(404);
    expect((await bOwner.patch(`/api/staff/${s.a.users.server1}`, { active: false })).status).toBe(404);
    expect((await bOwner.post('/api/cleaning', { tableId: aTable })).status).toBe(404);
    // B can't open an order on A's table or order A's menu items.
    expect((await bServer.post('/api/orders', { type: 'dine_in', tableId: aTable })).status).toBe(404);
    const bOrder = (await bServer.post('/api/orders', { type: 'dine_in', tableId: s.tableId(s.b.rid, 'Hut1') })).body;
    expect((await bServer.post(`/api/orders/${bOrder.id}/kot`, { items: [{ menuItemId: aItem, qty: 1 }] })).status).toBe(404);

    // Lists only contain own data.
    const floor = (await bOwner.get('/api/floor')).body;
    expect(floor.tables.every((t: any) => t.order?.id !== order.id)).toBe(true);
    expect((await bOwner.get('/api/kitchen')).body).toHaveLength(0);
    const staff = (await bOwner.get('/api/staff')).body;
    expect(staff.every((u: any) => u.id !== s.a.users.server1)).toBe(true);
    const audit = (await bOwner.get('/api/audit')).body;
    expect(audit.every((a: any) => a.entity_id !== order.id || a.entity !== 'order')).toBe(true);

    // Events are tagged with the right restaurant.
    expect(s.events.filter((e) => (e.payload as any)?.orderId === order.id).every((e) => e.rid === s.a.rid)).toBe(true);

    // A's data is unchanged.
    const again = (await aServer.get(`/api/orders/${order.id}`)).body;
    expect(again.items[0].status).toBe('queued');
  });

  it('login is scoped to restaurant code; same username in two restaurants are different people', async () => {
    const s = await setup();
    const a = await s.login('AAA', 'owner', 'owner123');
    const b = await s.login('BBB', 'owner', 'owner123');
    expect((await a.get('/api/me')).body.restaurant.code).toBe('AAA');
    expect((await b.get('/api/me')).body.restaurant.code).toBe('BBB');
    expect((await s.anon.post('/api/auth/login', { restaurantCode: 'ZZZ', username: 'owner', password: 'owner123' })).status).toBe(401);
  });

  it('security rules: B cannot read or write A\'s documents directly', async () => {
    const s = await setup();
    const aServer = await s.login('AAA', 'server1', 'server123');
    const order = (await aServer.post('/api/orders', { type: 'dine_in', tableId: s.tableId(s.a.rid, 'Hut1') })).body;
    const bOwner = await s.login('BBB', 'owner', 'owner123');
    // Bypassing the app and going straight to Firestore with B's login:
    await expect(getDoc(doc(bOwner.db, `restaurants/${s.a.rid}/orders/${order.id}`))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(bOwner.db, `restaurants/${s.a.rid}/orders/${order.id}`), { status: 'paid' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getDoc(doc(bOwner.db, `restaurants/${s.a.rid}`))).rejects.toMatchObject({ code: 'permission-denied' });
    // A's own staff can.
    expect((await getDoc(doc(aServer.db, `restaurants/${s.a.rid}/orders/${order.id}`))).exists()).toBe(true);
  });

  it('security rules: a server cannot change prices, staff or the activity log directly', async () => {
    const s = await setup();
    const server = await s.login('AAA', 'server1', 'server123');
    const item = s.itemId(s.a.rid, 'Coke');
    await expect(updateDoc(doc(server.db, `restaurants/${s.a.rid}/menu_items/${item}`), { price: 1 })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(server.db, `restaurants/${s.a.rid}/users/${s.a.users.chef}`), { role: 'owner' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(server.db, `restaurants/${s.a.rid}`), { settings: '{}' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getDoc(doc(server.db, `restaurants/${s.a.rid}/audit_log/1`))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('disabled staff and suspended restaurants lose access immediately', async () => {
    const s = await setup();
    const server = await s.login('AAA', 'server3', 'server123');
    const owner = await s.login('AAA', 'owner', 'owner123');
    expect((await server.get('/api/floor')).status).toBe(200);
    await owner.patch(`/api/staff/${s.a.users.server3}`, { active: false });
    expect((await server.get('/api/floor')).status).toBe(401);
    const p = await s.platformLogin();
    await p.patch(`/api/platform/restaurants/${s.a.rid}`, { active: false, suspendReason: 'test' });
    expect((await owner.get('/api/floor')).status).toBe(401);
  });
});

describe('roles', () => {
  it('servers, chefs and cleaners only reach their own screens', async () => {
    const s = await setup();
    const server = await s.login('AAA', 'server1', 'server123');
    const chef = await s.login('AAA', 'chef', 'chef123');
    const cleaner = await s.login('AAA', 'cleaner', 'cleaner123');
    const manager = await s.login('AAA', 'manager', 'manager123');
    for (const url of ['/api/reports/summary', '/api/staff', '/api/bills', '/api/settings', '/api/audit']) {
      expect((await server.get(url)).status).toBe(403);
    }
    expect((await chef.get('/api/floor')).status).toBe(403);
    expect((await chef.get('/api/kitchen')).status).toBe(200);
    expect((await chef.patch(`/api/menu/items/${s.itemId(s.a.rid, 'Coke')}`, { available: false })).status).toBe(200);
    expect((await chef.patch(`/api/menu/items/${s.itemId(s.a.rid, 'Coke')}`, { price: 1 })).status).toBe(403);
    // A partial edit only changes what was sent.
    const c65 = s.itemId(s.a.rid, 'Chicken 65');
    const edited = (await manager.patch(`/api/menu/items/${c65}`, { price: 23000 })).body;
    expect(edited).toMatchObject({ price: 23000, is_veg: 0, name: 'Chicken 65', available: 1 });
    expect((await cleaner.get('/api/kitchen')).status).toBe(403);
    expect((await cleaner.get('/api/cleaning')).status).toBe(200);
    // Managers can't create owners; owners can.
    expect((await manager.post('/api/staff', { name: 'X', username: 'xowner', role: 'owner', password: 'secret1' })).status).toBe(403);
    expect((await manager.post('/api/staff', { name: 'New', username: 'server9', role: 'server', password: 'secret1' })).status).toBe(201);
    expect((await manager.put('/api/settings', {})).status).toBe(403);
  });
});

describe('QR guest ordering', () => {
  it('guest scans, orders, staff accepts -> KOT', async () => {
    const s = await setup();
    const owner0 = await s.login('AAA', 'owner', 'owner123');
    const qr = (await owner0.get('/api/tables/qr')).body.find((x: any) => x.label === 'Op2');
    const token = { qr_token: qr.qr_token };
    let res = await s.anon.get(`/api/public/t/${token.qr_token}`);
    expect(res.status).toBe(200);
    expect(res.body.restaurant.name).toBe('Restaurant A');
    expect(res.body.table.label).toBe('Op2');
    expect(JSON.stringify(res.body)).not.toContain('password');
    res = await s.anon.post(`/api/public/t/${token.qr_token}/requests`, { kind: 'order', items: [{ menuItemId: s.itemId(s.a.rid, 'Chicken Biryani'), qty: 2 }] });
    expect(res.status).toBe(201);
    // A guest can't order another restaurant's item through this table.
    res = await s.anon.post(`/api/public/t/${token.qr_token}/requests`, { kind: 'order', items: [{ menuItemId: s.itemId(s.b.rid, 'Chicken Biryani'), qty: 2 }] });
    expect(res.status).toBe(409);

    const server = await s.login('AAA', 'server1', 'server123');
    const reqs = (await server.get('/api/guest-requests')).body;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].items[0].name).toBe('Chicken Biryani');
    res = await server.post(`/api/guest-requests/${reqs[0].id}/accept`);
    expect(res.body.orderId).toBeTruthy();
    const order = (await server.get(`/api/orders/${res.body.orderId}`)).body;
    expect(order.kots[0].source).toBe('qr');
    expect(order.items[0].qty).toBe(2);

    const bOwner = await s.login('BBB', 'owner', 'owner123');
    expect((await bOwner.get('/api/guest-requests')).body).toHaveLength(0);
    expect((await s.anon.get('/api/public/t/not-a-real-token')).status).toBe(404);
  });
});
