import { doc, writeBatch } from 'firebase/firestore';
import type { AppDeps } from './index';
import { newId } from './db';
import { newQrToken, addStaff } from './routes/admin';
import { createRestaurant } from './routes/platform';

const SECTIONS: [string, string[]][] = [
  ['Hut', ['Hut1', 'Hut2', 'Hut3', 'Hut4', 'Hut5', 'Hut6']],
  ['Big Hut', ['7A', '7B', '7C', '7D']],
  ['AC', ['AC1', 'AC2', 'AC3', 'AC4', 'AC5']],
  ['Open', ['Op1', 'Op2', 'Op3', 'Op4', 'Op5', 'Op6']],
  ['Front', ['Front1', 'Front2', 'Front3', 'Front4']],
];

// [name, price in rupees, veg, kitchen]
const MENU: [string, [string, number, boolean, boolean?][]][] = [
  ['Beverages', [['Water Bottle', 20, true, false], ['Coke', 40, true, false], ['Butter Milk', 30, true, false], ['Sweet Lassi', 60, true], ['Fresh Lime Soda', 50, true]]],
  ['Veg Starters', [['Baby Corn Chilli', 150, true], ['Paneer 65', 190, true], ['Gobi Manchurian', 140, true], ['Veg Spring Roll', 150, true]]],
  ['Non-Veg Starters', [['Chicken 65', 220, false], ['Apollo Fish', 260, false], ['Chilli Chicken', 230, false], ['Chicken Lollipop', 240, false], ['Dragon Chicken', 250, false]]],
  ['Veg Curries', [['Paneer Butter Masala', 220, true], ['Kadai Paneer', 220, true], ['Dal Tadka', 150, true], ['Mixed Veg Curry', 170, true]]],
  ['Non-Veg Curries', [['Butter Chicken', 260, false], ['Chicken Curry', 230, false], ['Mutton Curry', 320, false], ['Fish Curry', 280, false]]],
  ['Egg Items', [['Egg Bhurji', 110, false], ['Egg Curry', 140, false]]],
  ['Biryanis', [['Chicken Biryani', 250, false], ['Chicken Dum Biryani', 240, false], ['Mutton Biryani', 340, false], ['Veg Biryani', 180, true], ['Paneer Biryani', 220, true]]],
  ['Fried Rice', [['Paneer Fried Rice', 180, true], ['Veg Fried Rice', 150, true], ['Chicken Fried Rice', 190, false], ['Egg Fried Rice', 160, false]]],
  ['Breads', [['Butter Naan', 50, true], ['Garlic Naan', 60, true], ['Tandoori Roti', 30, true], ['Rumali Roti', 35, true]]],
  ['Tandoori', [['Tandoori Chicken (Half)', 280, false], ['Chicken Tikka', 260, false], ['Paneer Tikka', 230, true]]],
];

/** [username, display name, role, password] */
export const DEMO_STAFF: [string, string, string, string][] = [
  ['owner', 'Ravi (Owner)', 'owner', 'owner123'],
  ['trustee', 'Lakshmi (Trustee)', 'trustee', 'trustee123'],
  ['manager', 'Suresh (Manager)', 'manager', 'manager123'],
  ['biller', 'Biller', 'cashier', 'biller123'],
  ['server1', 'Anil', 'server', 'server123'],
  ['server2', 'Kiran', 'server', 'server123'],
  ['server3', 'Mahesh', 'server', 'server123'],
  ['chef', 'Head Chef', 'chef', 'chef123'],
  ['cleaner', 'Cleaning Crew', 'cleaner', 'cleaner123'],
];

type Deps = Pick<AppDeps, 'db' | 'app'>;

/**
 * A full demo restaurant, made the way a real one is: the platform admin creates the
 * restaurant and its logins, then the owner (signed in on their own device) adds tables
 * and the menu. Used by tests and to set up the live DEMO restaurant.
 */
export async function seedRestaurant(platform: Deps, signInOwner: (code: string, username: string, password: string) => Promise<Deps>,
  code: string, name: string, opts: { address?: string; phone?: string } = {}) {
  const { db: pdb, app } = platform;
  const [first, ...rest] = DEMO_STAFF;
  const { id: rid } = await createRestaurant(platform, {
    code, name, address: opts.address, phone: opts.phone,
    owner: { username: first[0], name: first[1], password: first[3] },
  });
  const users: Record<string, number> = {};
  for (const [username, display, role, password] of rest) {
    users[username] = await addStaff(app, pdb, rid, code.toUpperCase(), { username, name: display, role, password });
  }
  const { db } = await signInOwner(code, first[0], first[3]);
  const batch = writeBatch(db);
  const base = `restaurants/${rid}`;
  let sort = 0;
  SECTIONS.forEach(([section, labels], si) => {
    const sid = newId();
    batch.set(doc(db, `${base}/sections/${sid}`), { id: sid, restaurant_id: rid, name: section, sort: si });
    for (const label of labels) {
      const tid = newId();
      const token = newQrToken();
      batch.set(doc(db, `${base}/tables/${tid}`), {
        id: tid, restaurant_id: rid, section_id: sid, label, seats: 4, qr_token: token, needs_cleaning: 0, active: 1, sort: ++sort, live_order_id: null,
      });
      batch.set(doc(db, `qr_tokens/${token}`), { rid, table_id: tid, label });
    }
  });
  MENU.forEach(([cat, items], ci) => {
    const cid = newId();
    batch.set(doc(db, `${base}/menu_categories/${cid}`), { id: cid, restaurant_id: rid, name: cat, sort: ci, active: 1 });
    items.forEach(([n, price, veg, kitchen = true], ii) => {
      const mid = newId();
      batch.set(doc(db, `${base}/menu_items/${mid}`), {
        id: mid, restaurant_id: rid, category_id: cid, name: n, code: '', description: '', price: price * 100, is_veg: veg ? 1 : 0,
        available: 1, is_special: n === 'Chicken Dum Biryani' ? 1 : 0, send_to_kitchen: kitchen ? 1 : 0, active: 1, sort: ii,
      });
    });
  });
  await batch.commit();
  return { rid, users };
}
