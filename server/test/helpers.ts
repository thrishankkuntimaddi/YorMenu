import request from 'supertest';
import { openDb, one } from '../src/db.js';
import { createApp } from '../src/app.js';
import { Realtime } from '../src/realtime.js';
import { seedRestaurant } from '../src/demo.js';

export function setup() {
  const db = openDb(':memory:');
  const rt = new Realtime();
  const events: { rid: number; event: string; payload: unknown }[] = [];
  rt.emit = (rid, event, payload) => { events.push({ rid, event, payload }); };
  rt.emitToUser = (rid, _u, event, payload) => { events.push({ rid, event, payload }); };
  rt.emitToRoles = (rid, _r, event, payload) => { events.push({ rid, event, payload }); };
  const app = createApp({ db, secret: 'test-secret', rt });
  const a = seedRestaurant(db, 'AAA', 'Restaurant A');
  const b = seedRestaurant(db, 'BBB', 'Restaurant B');
  const api = request(app);

  async function login(code: string, username: string, password: string) {
    const res = await api.post('/api/auth/login').send({ restaurantCode: code, username, password });
    if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
    const token = res.body.token as string;
    const h = { Authorization: `Bearer ${token}` };
    return {
      token,
      get: (url: string) => api.get(url).set(h),
      post: (url: string, body: object = {}) => api.post(url).set(h).send(body),
      patch: (url: string, body: object = {}) => api.patch(url).set(h).send(body),
      put: (url: string, body: object = {}) => api.put(url).set(h).send(body),
      del: (url: string) => api.delete(url).set(h),
    };
  }
  const tableId = (rid: number, label: string) => one(db, 'SELECT id FROM tables WHERE restaurant_id = ? AND label = ?', rid, label)!.id as number;
  const itemId = (rid: number, name: string) => one(db, 'SELECT id FROM menu_items WHERE restaurant_id = ? AND name = ?', rid, name)!.id as number;
  return { db, api, app, a, b, login, tableId, itemId, events };
}
