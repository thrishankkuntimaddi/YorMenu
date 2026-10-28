import { useEffect, useState } from 'react';
import { api } from './api';
import { useLive } from './live';
import type { Catalog } from './types';

/*
 * Menu, tables and staff names, shared by the screens of the signed-in restaurant.
 * The copy belongs to one login: it is thrown away on login, logout and support mode,
 * and a load that was still running for the previous login is ignored.
 */
let cache: Catalog | null = null;
let inflight: Promise<Catalog> | null = null;
let generation = 0;
const subs = new Set<(c: Catalog | null) => void>();

async function fetchCatalog(force = false): Promise<Catalog> {
  if (cache && !force) return cache;
  const gen = generation;
  if (!inflight) {
    const p = api.get<Catalog>('/catalog').finally(() => { if (inflight === p) inflight = null; });
    inflight = p;
  }
  const c = await inflight;
  // Someone logged out (or into another restaurant) while this was loading.
  if (gen !== generation) throw new Error('Catalog belongs to a previous login');
  cache = c;
  subs.forEach((s) => s(c));
  return c;
}

export function useCatalog() {
  const [cat, setCat] = useState<Catalog | null>(cache);
  useEffect(() => { subs.add(setCat); fetchCatalog().then(setCat).catch(() => {}); return () => { subs.delete(setCat); }; }, []);
  useLive(['catalog:changed', 'reconnect'], () => { fetchCatalog(true).catch(() => {}); });
  return { catalog: cat, reload: () => fetchCatalog(true) };
}

/** Forget the menu and tables (another person or restaurant is about to use the app). */
export function clearCatalog() {
  generation++;
  cache = null;
  inflight = null;
  subs.forEach((s) => s(null));
}
