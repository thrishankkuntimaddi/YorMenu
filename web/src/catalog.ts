import { useEffect, useState } from 'react';
import { api } from './api';
import { useLive } from './live';
import type { Catalog } from './types';

let cache: Catalog | null = null;
let inflight: Promise<Catalog> | null = null;
const subs = new Set<(c: Catalog) => void>();

async function fetchCatalog(force = false) {
  if (cache && !force) return cache;
  if (!inflight) inflight = api.get<Catalog>('/catalog').finally(() => { inflight = null; });
  cache = await inflight;
  subs.forEach((s) => s(cache!));
  return cache;
}

export function useCatalog() {
  const [cat, setCat] = useState<Catalog | null>(cache);
  useEffect(() => { subs.add(setCat); fetchCatalog().then(setCat).catch(() => {}); return () => { subs.delete(setCat); }; }, []);
  useLive(['catalog:changed', 'reconnect'], () => { fetchCatalog(true).catch(() => {}); });
  return { catalog: cat, reload: () => fetchCatalog(true) };
}
export function clearCatalog() { cache = null; }
