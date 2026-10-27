// Builds the public website for Firebase Hosting.
// The APK and desktop installers are NOT uploaded: Firebase's free (Spark) plan forbids executable files.
// Host them on GitHub Releases / Google Drive and set VITE_APK_DOWNLOAD_URL / VITE_DESKTOP_DOWNLOAD_URL.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

execSync('npm run build --workspace web', { stdio: 'inherit' });
fs.rmSync('web/dist/downloads', { recursive: true, force: true });
