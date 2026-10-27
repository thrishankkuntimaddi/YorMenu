import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, one } from './db.js';
import { seedRestaurant, DEMO_STAFF } from './demo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? path.resolve(here, '../../data');
fs.mkdirSync(dataDir, { recursive: true });
const db = openDb(path.join(dataDir, 'cuddly.db'));

if (one(db, `SELECT id FROM restaurants WHERE code = 'DEMO'`)) {
  console.log('Demo restaurant already exists (code DEMO).');
} else {
  seedRestaurant(db, 'DEMO', 'Annapurna Dhaba - Bathalapalli', { address: 'Dharmavaram Road, Bathalapalli', phone: '9440514959' });
  console.log('Seeded demo restaurant. Restaurant code: DEMO');
}
console.log('Logins (username / password):');
for (const [u, n, role, p] of DEMO_STAFF) console.log(`  ${role.padEnd(8)} ${u.padEnd(10)} ${p}   (${n})`);
