import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, one, run } from './db.js';
import { loadJwtSecret, hashPassword } from './auth.js';
import { Realtime } from './realtime.js';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? path.resolve(here, '../../data');
fs.mkdirSync(dataDir, { recursive: true });

const db = openDb(path.join(dataDir, 'cuddly.db'));
const secret = loadJwtSecret(dataDir);

if (!one(db, 'SELECT id FROM platform_admins LIMIT 1')) {
  const user = process.env.PLATFORM_ADMIN_USER ?? 'admin';
  const pass = process.env.PLATFORM_ADMIN_PASSWORD ?? 'admin123';
  run(db, 'INSERT INTO platform_admins (username, name, password_hash) VALUES (?, ?, ?)', user, 'Platform admin', hashPassword(pass));
  console.log(`Created platform admin "${user}"${process.env.PLATFORM_ADMIN_PASSWORD ? '' : ' with default password admin123. Change it via PLATFORM_ADMIN_PASSWORD.'}`);
}

const rt = new Realtime();
const app = createApp({ db, secret, rt }, { webDist: path.resolve(here, '../../web/dist') });
const server = http.createServer(app);
rt.attach(server, db, secret);

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => console.log(`Cuddly POS API on http://localhost:${port}`));
