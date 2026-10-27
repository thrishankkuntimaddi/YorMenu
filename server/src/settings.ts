import { z } from 'zod';

export const settingsSchema = z.object({
  currency: z.string().default('INR'),
  timezone: z.string().default('Asia/Kolkata'),
  countryCode: z.string().regex(/^\d{1,4}$/).default('91'),
  taxMode: z.enum(['exclusive', 'inclusive', 'none']).default('exclusive'),
  taxes: z.array(z.object({ name: z.string().min(1).max(20), rate: z.number().min(0).max(100) }))
    .max(5).default([{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }]),
  serviceChargePct: z.number().min(0).max(100).default(0),
  roundOff: z.boolean().default(true),
  billPrefix: z.string().max(10).default(''),
  billFooter: z.string().max(200).default('Thank you! Visit again.'),
  autoCleaning: z.boolean().default(true),
  qrOrdering: z.boolean().default(true),
  serversSeeAllTables: z.boolean().default(true),
  kotPrinter: z.object({ host: z.string(), port: z.number().int().default(9100) }).nullable().default(null),
  billPrinter: z.object({ host: z.string(), port: z.number().int().default(9100) }).nullable().default(null),
});
export type Settings = z.infer<typeof settingsSchema>;

export function parseSettings(json: string | null | undefined): Settings {
  let raw: unknown = {};
  try { raw = JSON.parse(json || '{}'); } catch { /* fall back to defaults */ }
  const r = settingsSchema.safeParse(raw);
  return r.success ? r.data : settingsSchema.parse({});
}

/** Business date (YYYY-MM-DD) in the restaurant's timezone. */
export function businessDate(tz: string, d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
