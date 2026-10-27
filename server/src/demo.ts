import crypto from 'node:crypto';
import { DB, run, tx } from './db.js';
import { hashPassword } from './auth.js';
import { settingsSchema } from './settings.js';

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

export function seedRestaurant(db: DB, code: string, name: string, opts: { address?: string; phone?: string } = {}) {
  return tx(db, () => {
    const rid = run(db, 'INSERT INTO restaurants (code, name, address, phone, settings) VALUES (?, ?, ?, ?, ?)',
      code, name, opts.address ?? '', opts.phone ?? '', JSON.stringify(settingsSchema.parse({}))).id;
    const users: Record<string, number> = {};
    for (const [username, display, role, password] of DEMO_STAFF) {
      users[username] = run(db, 'INSERT INTO users (restaurant_id, username, name, role, password_hash) VALUES (?, ?, ?, ?, ?)',
        rid, username, display, role, hashPassword(password)).id;
    }
    let sort = 0;
    SECTIONS.forEach(([section, labels], si) => {
      const sid = run(db, 'INSERT INTO sections (restaurant_id, name, sort) VALUES (?, ?, ?)', rid, section, si).id;
      for (const label of labels) {
        run(db, 'INSERT INTO tables (restaurant_id, section_id, label, qr_token, sort) VALUES (?, ?, ?, ?, ?)',
          rid, sid, label, crypto.randomBytes(12).toString('base64url'), ++sort);
      }
    });
    MENU.forEach(([cat, items], ci) => {
      const cid = run(db, 'INSERT INTO menu_categories (restaurant_id, name, sort) VALUES (?, ?, ?)', rid, cat, ci).id;
      items.forEach(([n, price, veg, kitchen = true], ii) => {
        run(db, `INSERT INTO menu_items (restaurant_id, category_id, name, price, is_veg, send_to_kitchen, is_special, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          rid, cid, n, price * 100, veg ? 1 : 0, kitchen ? 1 : 0, n === 'Chicken Dum Biryani' ? 1 : 0, ii);
      });
    });
    return { rid, users };
  });
}
