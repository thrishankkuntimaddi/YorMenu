import path from 'node:path';
import fs from 'node:fs';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { DB } from './db.js';
import { HttpError } from './errors.js';
import { Realtime } from './realtime.js';
import { staffAuth } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { platformRoutes } from './routes/platform.js';
import { adminRoutes } from './routes/admin.js';
import { opsRoutes } from './routes/ops.js';
import { publicRoutes } from './routes/public.js';

export type AppDeps = { db: DB; secret: string; rt: Realtime };

export function createApp(deps: AppDeps, opts: { webDist?: string } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(express.json({ limit: '256kb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => { res.json({ ok: true }); });
  api.use(authRoutes(deps));
  api.use(publicRoutes(deps));
  api.use(platformRoutes(deps));
  api.use(staffAuth(deps.db, deps.secret));
  api.use(adminRoutes(deps));
  api.use(opsRoutes(deps));
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  if (opts.webDist && fs.existsSync(opts.webDist)) {
    app.use(express.static(opts.webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(opts.webDist!, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    if (err instanceof SyntaxError && 'body' in (err as object)) {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });
  return app;
}
