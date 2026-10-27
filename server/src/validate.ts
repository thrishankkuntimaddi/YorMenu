import { z } from 'zod';
import { badRequest } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data === undefined && schema instanceof z.ZodObject ? {} : data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw badRequest(`${first.path.join('.') || 'input'}: ${first.message}`, r.error.issues);
  }
  return r.data;
}

export const id = z.coerce.number().int().positive();
export const paise = z.number().int().min(0).max(100_000_000);
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
