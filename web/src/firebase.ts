// Firebase in the app: sign-in (Firebase Auth), data (Firestore, guarded by security
// rules) and Analytics on the public website pages only. Free Spark plan.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDY9i6pkVdf7SbaebYdrM3o_P2gD-OSMHg',
  authDomain: 'yormenu-91d7a.firebaseapp.com',
  projectId: 'yormenu-91d7a',
  storageBucket: 'yormenu-91d7a.firebasestorage.app',
  messagingSenderId: '710184627443',
  appId: '1:710184627443:web:843181f08eadeb48345b86',
  measurementId: 'G-YPYVE8F47M',
};

/** Local development talks to the Firebase emulators on the same machine. */
const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_PROD_FIREBASE !== '1';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

export function firebaseApp() {
  if (!app) app = initializeApp(useEmulators ? { ...firebaseConfig, projectId: 'demo-yormenu' } : firebaseConfig);
  return app;
}

/** Resolves once Firebase has restored the signed-in person (if any) after a reload. */
export function authReady(): Promise<void> {
  const a = fbAuth();
  return (a as Auth & { authStateReady?: () => Promise<void> }).authStateReady?.() ?? Promise.resolve();
}

export function fbAuth(): Auth {
  if (!auth) {
    auth = getAuth(firebaseApp());
    if (useEmulators) connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
  }
  return auth;
}

export function fbDb(): Firestore {
  if (!db) {
    db = initializeFirestore(firebaseApp(), { ignoreUndefinedProperties: true });
    if (useEmulators) connectFirestoreEmulator(db, location.hostname, 8080);
  }
  return db;
}

let analyticsStarted = false;
export async function startSiteAnalytics() {
  if (analyticsStarted || useEmulators) return;
  analyticsStarted = true;
  const { getAnalytics, isSupported } = await import('firebase/analytics');
  if (await isSupported()) getAnalytics(firebaseApp());
}
