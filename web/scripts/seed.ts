// Creates the first platform admin, the support contact and the DEMO restaurant.
// Runs the same app logic as the website, so the security rules are respected.
//
//   Local (emulators):  ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run seed      (inside `npm run dev`)
//   Live project:       YORMENU_LIVE=1 ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run seed --workspace web
//
// Passwords come from the environment only; nothing is stored in code.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signOut } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, doc, getDoc, terminate } from 'firebase/firestore';
import { createCore } from '../src/core';
import { seedRestaurant, DEMO_STAFF } from '../src/core/demo';

const live = process.env.YORMENU_LIVE === '1';
const config = live
  ? { apiKey: 'AIzaSyDY9i6pkVdf7SbaebYdrM3o_P2gD-OSMHg', authDomain: 'yormenu-91d7a.firebaseapp.com', projectId: 'yormenu-91d7a', appId: '1:710184627443:web:843181f08eadeb48345b86' }
  : { apiKey: 'demo-key', projectId: process.env.GCLOUD_PROJECT ?? 'demo-yormenu', authDomain: 'localhost' };

function device(name: string) {
  const app = initializeApp(config, name);
  const auth = getAuth(app);
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  if (!live) {
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}`, { disableWarnings: true });
    const [h, p] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
    connectFirestoreEmulator(db, h, Number(p));
  }
  return { app, auth, db, core: createCore(app, db, auth) };
}

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  console.log('Set ADMIN_EMAIL and ADMIN_PASSWORD to create the platform admin and the DEMO restaurant.');
  process.exit(0);
}
console.log(`Seeding ${live ? 'LIVE project yormenu-91d7a' : 'local emulators'}…`);

const admin = device('admin');
let r = await admin.core.dispatch('POST', '/auth/platform/login', { username: email, password });
if (r.status !== 200) {
  r = await admin.core.dispatch('POST', '/platform/bootstrap', {
    email, password, name: process.env.ADMIN_NAME ?? 'Platform admin',
    contact: {
      supportName: process.env.SUPPORT_NAME ?? 'K Thrishank', supportPhone: process.env.SUPPORT_PHONE ?? '9381870544', supportWhatsapp: process.env.SUPPORT_PHONE ?? '9381870544',
      supportEmail: process.env.SUPPORT_EMAIL ?? 'thrishankkuntimaddi@gmail.com',
    },
  });
  if (r.status !== 201) { console.error('Could not create the platform admin:', r.body?.error); process.exit(1); }
  console.log(`Platform admin ${email} created.`);
} else {
  console.log(`Platform admin ${email} already exists.`);
}

if ((await getDoc(doc(admin.db, 'restaurant_codes/DEMO'))).exists()) {
  console.log('Demo restaurant already exists (code DEMO).');
} else {
  let n = 0;
  await seedRestaurant(admin, async (code, username, pw) => {
    const d = device(`owner${n++}`);
    const res = await d.core.dispatch('POST', '/auth/login', { restaurantCode: code, username, password: pw });
    if (res.status !== 200) throw new Error(`owner login failed: ${res.body?.error}`);
    return d;
  }, 'DEMO', 'Annapurna Dhaba - Bathalapalli', { address: 'Dharmavaram Road, Bathalapalli', phone: '9440514959' });
  console.log('Demo restaurant created. Restaurant code: DEMO');
}
console.log('Demo logins (restaurant code DEMO):');
for (const [u, n, role, p] of DEMO_STAFF) console.log(`  ${role.padEnd(8)} ${u.padEnd(10)} ${p}   (${n})`);
await signOut(admin.auth);
await terminate(admin.db);
process.exit(0);
