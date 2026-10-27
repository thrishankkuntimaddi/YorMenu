import { describe, it, expect } from 'vitest';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import { setup, device, ADMIN } from './helpers.js';

describe('security rules (people bypassing the app)', () => {
  it('guests can only ask for the table their QR code belongs to', async () => {
    const s = await setup();
    const owner = await s.login('AAA', 'owner', 'owner123');
    const qr = (await owner.get('/api/tables/qr')).body.find((x: any) => x.label === 'Op2');
    const guest = device();
    const base = { restaurant_id: s.a.rid, token: qr.qr_token, table_id: qr.id, table_label: 'Op2', kind: 'call_waiter', payload: '{}', status: 'pending', handled_by: null, order_id: null, created_at: 'x', handled_at: null };
    await setDoc(doc(guest.db, `restaurants/${s.a.rid}/guest_requests/1`), { id: 1, ...base });
    // Wrong table for this token, already-accepted status, or another restaurant: refused.
    await expect(setDoc(doc(guest.db, `restaurants/${s.a.rid}/guest_requests/2`), { id: 2, ...base, table_id: s.tableId(s.a.rid, 'Hut1') })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(guest.db, `restaurants/${s.a.rid}/guest_requests/3`), { id: 3, ...base, status: 'accepted' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(guest.db, `restaurants/${s.b.rid}/guest_requests/4`), { id: 4, ...base, restaurant_id: s.b.rid })).rejects.toMatchObject({ code: 'permission-denied' });
    // Guests can't read orders or requests.
    await expect(getDoc(doc(guest.db, `restaurants/${s.a.rid}/guest_requests/1`))).rejects.toMatchObject({ code: 'permission-denied' });
    // Through the app the guest flow works end to end.
    expect((await s.anon.get(`/api/public/t/${qr.qr_token}`)).body.table.label).toBe('Op2');
  });

  it('a manager cannot give themselves or a server more power directly', async () => {
    const s = await setup();
    const manager = await s.login('AAA', 'manager', 'manager123');
    const ref = doc(manager.db, `restaurants/${s.a.rid}`);
    const perms = (await getDoc(ref)).data()!.perms;
    await expect(updateDoc(ref, { perms: { ...perms, manager: [...perms.manager, 'settings.edit'] } })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(ref, { perms: { ...perms, server: [...perms.server, 'settings.edit'] } })).rejects.toMatchObject({ code: 'permission-denied' });
    // Can't make anyone an owner, and can't edit their own login record.
    await expect(updateDoc(doc(manager.db, `restaurants/${s.a.rid}/users/${s.a.users.server1}`), { role: 'owner' })).rejects.toMatchObject({ code: 'permission-denied' });
    // Allowed: giving a server something the manager has.
    await updateDoc(ref, { perms: { ...perms, server: [...perms.server, 'bill.view'] } });
  });

  it('the one-time platform setup cannot be run again', async () => {
    const s = await setup();
    const again = device();
    const r = await again.post('/platform/bootstrap', { email: 'evil@example.com', password: 'another-long-pass', name: 'Evil' });
    expect(r.status).toBe(403);
    expect((await device().post('/auth/platform/login', { username: 'evil@example.com', password: 'another-long-pass' })).status).toBe(401);
    expect((await device().post('/auth/platform/login', { username: ADMIN.email, password: ADMIN.password })).status).toBe(200);
    void s;
  });

  it('owner can reset a staff password; the old password stops working', async () => {
    const s = await setup();
    const owner = await s.login('AAA', 'owner', 'owner123');
    expect((await owner.patch(`/api/staff/${s.a.users.server2}`, { password: 'newpass9' })).status).toBe(200);
    expect((await device().post('/auth/login', { restaurantCode: 'AAA', username: 'server2', password: 'server123' })).status).toBe(401);
    const w = device();
    expect((await w.post('/auth/login', { restaurantCode: 'AAA', username: 'server2', password: 'newpass9' })).status).toBe(200);
    expect((await w.get('/floor')).status).toBe(200);
  });
});
