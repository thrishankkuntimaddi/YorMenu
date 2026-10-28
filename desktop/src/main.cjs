// YorMenu Desktop: the counter PC app. It opens the YorMenu website (same live data as
// phones and the browser) and acts as the print station for the restaurant's
// KOT / bill thermal printers on the local network or USB.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, powerSaveBlocker } = require('electron');
const path = require('node:path');
const net = require('node:net');

// The live YorMenu website. Override with YORMENU_URL (e.g. http://localhost:5173 while developing).
const APP_URL = (process.env.YORMENU_URL || 'https://yormenu.poelys.com').replace(/\/$/, '');
const APP_ORIGIN = new URL(APP_URL).origin;
const BUILD = __dirname;

let win = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
}

/** Printers must be on the restaurant's own network; never let a print job reach the internet. */
function isLocalAddress(host) {
  if (!net.isIPv4(host)) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function sendRaw(host, port, data, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    let done = false;
    const finish = (err) => { if (done) return; done = true; sock.destroy(); err ? reject(err) : resolve(); };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => sock.end(data, () => setTimeout(() => finish(), 200)));
    sock.on('timeout', () => finish(new Error(`printer at ${host}:${port} did not answer`)));
    sock.on('error', (e) => finish(new Error(e.code === 'ECONNREFUSED' ? `printer at ${host}:${port} refused the connection` : e.message)));
  });
}

ipcMain.handle('print:raw', async (_e, host, port, base64) => {
  if (typeof host !== 'string' || !isLocalAddress(host)) throw new Error('Printer IP must be on the local network (e.g. 192.168.1.50)');
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('Bad printer port');
  const data = Buffer.from(String(base64), 'base64');
  if (!data.length || data.length > 512 * 1024) throw new Error('Bad print job');
  await sendRaw(host, p, data);
});

/** Silent printing to the Windows/Mac default printer (USB thermal printer). */
ipcMain.handle('print:html', async (_e, html) => {
  if (typeof html !== 'string' || html.length > 500_000) throw new Error('Bad print job');
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((resolve, reject) => w.webContents.print(
      { silent: true, printBackground: true, margins: { marginType: 'none' } },
      (ok, reason) => (ok ? resolve() : reject(new Error(reason || 'Print failed'))),
    ));
  } finally { w.destroy(); }
});

function guardWindow(w) {
  // Stay inside YorMenu; WhatsApp, phone and other links open in the system browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('blob:') || url === 'about:blank') return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN) && !url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); }
  });
  // No internet: show a friendly page that retries.
  w.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && url.startsWith(APP_ORIGIN)) w.loadFile(path.join(BUILD, 'offline.html'), { query: { url } });
  });
}

function openWindow() {
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 900, minHeight: 600, title: 'YorMenu',
    webPreferences: { preload: path.join(BUILD, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  guardWindow(win);
  win.loadURL(`${APP_URL}/login`);
  win.on('close', (e) => {
    if (quitting) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Keep running', 'Quit YorMenu'], defaultId: 0, cancelId: 0,
      message: 'Quit YorMenu?', detail: 'This PC prints the KOTs and bills. While YorMenu is closed, print jobs wait and print when you open it again.',
    });
    if (choice === 0) e.preventDefault(); else { quitting = true; app.quit(); }
  });
  win.on('closed', () => { win = null; });
}

// YorMenu support contact, read from the live platform settings (public), with a built-in fallback.
const SUPPORT_FALLBACK = { name: 'K Thrishank', phone: '9381870544', email: 'thrishankkuntimaddi@gmail.com', hours: '9 AM – 10 PM, all days' };
async function supportContact() {
  try {
    const r = await fetch('https://firestore.googleapis.com/v1/projects/yormenu-91d7a/databases/(default)/documents/platform_settings/contact', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return SUPPORT_FALLBACK;
    const f = (await r.json()).fields ?? {};
    const v = (k) => f[k]?.stringValue || '';
    return { name: v('supportName') || SUPPORT_FALLBACK.name, phone: v('supportPhone') || SUPPORT_FALLBACK.phone, email: v('supportEmail') || SUPPORT_FALLBACK.email, hours: v('supportHours') || SUPPORT_FALLBACK.hours };
  } catch { return SUPPORT_FALLBACK; }
}
async function showSupport() {
  const c = await supportContact();
  const wa = c.phone.replace(/\D/g, '');
  const choice = await dialog.showMessageBox(win ?? undefined, {
    type: 'info', title: 'YorMenu support', message: `YorMenu support: ${c.name}`,
    detail: `Phone / WhatsApp: ${c.phone}\nEmail: ${c.email}\nHours: ${c.hours}`,
    buttons: ['WhatsApp', 'Email', 'Close'], defaultId: 2, cancelId: 2,
  });
  if (choice.response === 0) shell.openExternal(`https://wa.me/${wa.length === 10 ? `91${wa}` : wa}`);
  if (choice.response === 1) shell.openExternal(`mailto:${c.email}`);
}

function buildMenu() {
  const login = app.getLoginItemSettings();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'YorMenu',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+H', click: () => win?.loadURL(`${APP_URL}/login`) },
        { label: 'Start YorMenu when the computer starts', type: 'checkbox', checked: login.openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
        { label: 'Printer setup guide', click: () => win?.loadURL(`${APP_URL}/help`) },
        { label: 'Contact YorMenu support…', click: () => { showSupport(); } },
        { label: 'Check for updates…', click: () => { checkForUpdate(true); } },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } },
      ],
    },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { role: 'help', submenu: [{ label: 'Contact YorMenu support…', click: () => { showSupport(); } }] },
  ]));
}

// ---- Updates: tell the counter staff when a newer YorMenu desktop app is released ----
const REPO = 'thrishankkuntimaddi/YorMenu';
const newer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
};
let skipped = '';
async function checkForUpdate(manual = false) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`GitHub said ${r.status}`);
    const rel = await r.json();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    if (!latest || !newer(latest, app.getVersion())) {
      if (manual) dialog.showMessageBox(win ?? undefined, { type: 'info', message: 'YorMenu is up to date', detail: `You have version ${app.getVersion()}.` });
      return;
    }
    if (!manual && skipped === latest) return;
    const file = process.platform === 'win32' ? 'YorMenu-Windows-Setup.exe'
      : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'YorMenu-Mac-AppleSilicon.dmg' : 'YorMenu-Mac-Intel.dmg') : 'YorMenu-Linux.AppImage';
    const choice = await dialog.showMessageBox(win ?? undefined, {
      type: 'info', title: 'Update available', message: `YorMenu ${latest} is available`,
      detail: `You have ${app.getVersion()}. Download and install the new version, then open YorMenu again. Your login and printers stay as they are.`,
      buttons: ['Download update', 'Later'], defaultId: 0, cancelId: 1,
    });
    if (choice.response === 0) shell.openExternal(`https://github.com/${REPO}/releases/download/${rel.tag_name}/${file}`);
    else skipped = latest;
  } catch (e) {
    if (manual) dialog.showMessageBox(win ?? undefined, { type: 'warning', message: 'Could not check for updates', detail: String(e?.message ?? e) });
  }
}

app.whenReady().then(() => {
  // A counter PC that sleeps stops printing KOTs.
  powerSaveBlocker.start('prevent-app-suspension');
  buildMenu();
  openWindow();
  setTimeout(() => checkForUpdate(false), 15_000);
  setInterval(() => checkForUpdate(false), 6 * 3600_000);
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (quitting || process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win) openWindow(); });
