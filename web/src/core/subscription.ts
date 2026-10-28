import { doc } from 'firebase/firestore';
import { z } from 'zod';
import { DB, Row, one } from './db';
import { HttpError } from './errors';

/*
 * YorMenu subscriptions. Shops that sign up get a free trial; then they pay a plan by UPI
 * and a platform admin confirms the payment, which extends `paid_until`.
 * Restaurants created before subscriptions existed (no trial_ends / paid_until) never expire.
 */

export const GRACE_DAYS = 5;

export const planSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{2,30}$/),
  name: z.string().trim().min(1).max(60),
  price: z.number().int().min(0).max(1_000_000), // rupees
  days: z.number().int().min(1).max(3660),
  for: z.enum(['counter', 'restaurant', 'all']).default('all'),
});
export type Plan = z.infer<typeof planSchema>;

export const billingSchema = z.object({
  upiId: z.string().trim().max(80).default(''),
  payeeName: z.string().trim().max(80).default('YorMenu'),
  trialDays: z.number().int().min(0).max(365).default(30),
  plans: z.array(planSchema).max(12).default([
    { id: 'shop-month', name: 'Small shop · monthly', price: 199, days: 30, for: 'counter' },
    { id: 'shop-year', name: 'Small shop · yearly', price: 1999, days: 365, for: 'counter' },
    { id: 'rest-month', name: 'Restaurant · monthly', price: 799, days: 30, for: 'restaurant' },
    { id: 'rest-year', name: 'Restaurant · yearly', price: 7999, days: 365, for: 'restaurant' },
  ]),
});
export type Billing = z.infer<typeof billingSchema>;

export async function billingSettings(db: DB): Promise<Billing> {
  const saved = await one(doc(db, 'platform_settings/billing')).catch(() => undefined);
  const r = billingSchema.safeParse(saved ?? {});
  return r.success ? r.data : billingSchema.parse({});
}

export type SubState = { status: 'free' | 'trial' | 'active' | 'grace' | 'expired'; until: string | null; daysLeft: number | null; plan: string | null };

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);

export function subscriptionState(r: Row): SubState {
  const until: string | null = [r.paid_until, r.trial_ends].filter(Boolean).sort().pop() ?? null;
  if (!until) return { status: 'free', until: null, daysLeft: null, plan: r.plan_id ?? null };
  const left = daysBetween(today(), until);
  const status = left >= 0 ? (r.paid_until && r.paid_until >= today() ? 'active' : 'trial') : left >= -GRACE_DAYS ? 'grace' : 'expired';
  return { status, until, daysLeft: left, plan: r.plan_id ?? null };
}

/** New orders and bills stop once the subscription (plus grace days) has run out. */
export function assertSubscribed(r: Row) {
  if (subscriptionState(r).status === 'expired') {
    throw new HttpError(402, 'Your YorMenu subscription has ended. Renew it under Subscription to keep billing.');
  }
}
