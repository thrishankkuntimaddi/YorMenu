import { Router } from '../http.js';
import { z } from 'zod';
import type { AppDeps } from '../index.js';
import { parse, id } from '../validate.js';
import { publicMenu, createGuestRequest } from '../services/guest.js';

/** No login: what a guest sees after scanning the QR code on their table. */
export function publicRoutes({ db }: AppDeps) {
  const r = new Router();
  const token = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/);
  r.get('/public/t/:token', async (req, res) => {
    res.json(await publicMenu(db, parse(token, req.params.token)));
  });
  r.post('/public/t/:token/requests', async (req, res) => {
    const b = parse(z.object({
      kind: z.enum(['order', 'call_waiter', 'request_bill']),
      items: z.array(z.object({ menuItemId: id, qty: z.number().int().min(1).max(50), note: z.string().max(120).optional() })).max(50).optional(),
      note: z.string().max(200).optional(),
    }), req.body);
    res.status(201).json(await createGuestRequest(db, parse(token, req.params.token), b));
  });
  return r;
}
