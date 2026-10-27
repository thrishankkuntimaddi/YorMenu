// Bundles the desktop app (main + preload + offline page) into desktop/build.
// The app itself loads the live YorMenu website, so nothing else is packaged.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'build');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['main.cjs', 'preload.cjs']) {
  await build({ entryPoints: [path.join(here, 'src', f)], outfile: path.join(out, f), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'warning' });
}
fs.copyFileSync(path.join(here, 'src/offline.html'), path.join(out, 'offline.html'));
console.log('desktop build ready in', out);
