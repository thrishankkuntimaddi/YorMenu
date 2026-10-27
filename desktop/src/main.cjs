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
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } },
      ],
    },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
  ]));
}

app.whenReady().then(() => {
  // A counter PC that sleeps stops printing KOTs.
  powerSaveBlocker.start('prevent-app-suspension');
  buildMenu();
  openWindow();
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (quitting || process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win) openWindow(); });
