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
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#b91c1c'),
  language: z.enum(['en', 'te', 'hi']).default('en'),
  /** Log a device out after this many idle minutes (0 = never). */
  idleLogoutMinutes: z.number().int().min(0).max(720).default(0),
  /** Paper width of the thermal printers. */
  paperWidth: z.enum(['80', '58']).default('80'),
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

/** Owner's automatic report delivery. Stored apart from settings so its SMTP password never reaches the settings screen. */
export const reportSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  daily: z.boolean().default(true),
  weekly: z.boolean().default(true),
  monthly: z.boolean().default(true),
  /** 0 = Sunday. Weekly report goes on this day. */
  weekday: z.number().int().min(0).max(6).default(0),
  /** Local time the reports go out, HH:MM. */
  sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('23:00'),
  recipients: z.array(z.string().email()).max(10).default([]),
  /** Owner's WhatsApp number for the summary link. */
  whatsappTo: z.string().max(20).default(''),
  attachXlsx: z.boolean().default(true),
  attachPdf: z.boolean().default(true),
  smtp: z.object({
    host: z.string().min(1).max(200),
    port: z.number().int().min(1).max(65535).default(465),
    secure: z.boolean().default(true),
    user: z.string().max(200).default(''),
    pass: z.string().max(200).default(''),
    from: z.string().max(200).default(''),
  }).nullable().default(null),
  lastSent: z.object({ daily: z.string().optional(), weekly: z.string().optional(), monthly: z.string().optional() }).default({}),
});
export type ReportSettings = z.infer<typeof reportSettingsSchema>;

export function parseReportSettings(json: string | null | undefined): ReportSettings {
  let raw: unknown = {};
  try { raw = JSON.parse(json || '{}'); } catch { /* defaults */ }
  const r = reportSettingsSchema.safeParse(raw);
  return r.success ? r.data : reportSettingsSchema.parse({});
}

/** Local wall-clock parts in a time zone. */
export function localParts(tz: string, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, weekday };
}
