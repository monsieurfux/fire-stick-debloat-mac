// Electron main process: owns adb and the connected stick, and answers the
// window's requests over IPC. The window never runs commands itself.
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findAdb, downloadPlatformTools, makeRunner, download, SDK_TERMS_URL } = require('./core/adb');
const { findSticks, IP_RE } = require('./core/discovery');
const { Stick, HOME_ON_FIRE_APK, PROJECTIVY_PAGE } = require('./core/stick');

// FSD_DATA_DIR lets the automated tests point the app at a throwaway folder.
if (process.env.FSD_DATA_DIR) app.setPath('userData', process.env.FSD_DATA_DIR);
const dataDir = app.getPath('userData');
const logDir = path.join(dataDir, 'logs');

let win = null;
let adbPath = null;
let run = null;
let stick = null;
let runLog = null;

// Each run is logged to logs/run-<date>.txt (the newest 10 are kept) so it
// can be attached to a bug report.
function startRunLog() {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const old = fs.readdirSync(logDir).filter((f) => /^run-.*\.txt$/.test(f)).sort().reverse().slice(9);
    for (const f of old) fs.rmSync(path.join(logDir, f), { force: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..*$/, '');
    runLog = fs.createWriteStream(path.join(logDir, `run-${stamp}.txt`), { flags: 'a' });
  } catch { runLog = null; }
}

function log(message, level = 'info') {
  if (runLog) runLog.write(`${new Date().toISOString()} [${level}] ${message}\n`);
  if (win && !win.isDestroyed()) win.webContents.send('log', { message, level });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: 'Fire Stick Debloat',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#111318',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function requireStick() {
  if (!stick) throw new Error('No Fire Stick is connected.');
  return stick;
}

// --- adb -----------------------------------------------------------------

ipcMain.handle('adb:status', () => {
  adbPath = findAdb(dataDir);
  if (adbPath) run = makeRunner(adbPath);
  return { found: Boolean(adbPath), path: adbPath, termsUrl: SDK_TERMS_URL, dataDir };
});

ipcMain.handle('adb:download', async () => {
  try {
    adbPath = await downloadPlatformTools(dataDir, (got, total) => send('adb:progress', { got, total }));
    run = makeRunner(adbPath);
    log(`Downloaded platform-tools to ${path.dirname(adbPath)}`, 'ok');
    return { ok: true, path: adbPath };
  } catch (e) {
    log(`Download failed: ${e.message}`, 'error');
    return { ok: false, error: e.message };
  }
});

// --- finding and connecting ---------------------------------------------

ipcMain.handle('stick:find', async () => {
  const { found, range } = await findSticks({ onProgress: (done, total) => send('find:progress', { done, total }) });
  if (range) log(`Searched ${range[0]} to ${range[1]}: ${found.length} device(s) accept ADB connections.`, 'dim');
  return { found, range };
});

let opening = null;
ipcMain.handle('stick:open', async (_e, { ip }) => {
  if (!run) return { ok: false, reason: 'no-adb' };
  if (!IP_RE.test(ip)) return { ok: false, reason: 'bad-ip' };
  // One connect at a time: a second request joins the one in flight.
  if (opening) return opening;
  opening = openStick(ip).finally(() => { opening = null; });
  return opening;
});

async function openStick(ip) {
  const previous = stick;
  const next = new Stick({ run, ip, dataDir, log });
  log(`Connecting to ${ip} ...`, 'info');
  const r = await next.open({ onPrompt: () => send('stick:prompt', { ip }) });
  if (!r.ok) {
    log(`Couldn't connect to ${ip}: ${r.reason}${r.detail ? ` (${r.detail})` : ''}`, 'error');
    return r;
  }
  stick = next;
  if (previous && previous.target !== next.target) await previous.disconnect();
  log(`Connected to ${r.name} at ${ip}`, 'ok');
  return { ...r, ip, serial: next.serial };
}

ipcMain.handle('stick:current', () => (stick ? { ip: stick.ip, name: stick.name, removedCount: stick.localList().length } : null));

// --- actions -------------------------------------------------------------

ipcMain.handle('stick:preview', () => requireStick().preview());
ipcMain.handle('stick:cleanup', (_e, { chosen }) => requireStick().cleanup(Array.isArray(chosen) ? chosen : []));
ipcMain.handle('stick:undo', () => requireStick().undo());
ipcMain.handle('stick:reapply', () => requireStick().reapply());
ipcMain.handle('stick:removedList', () => requireStick().localList());
ipcMain.handle('stick:yourApps', () => requireStick().getYourApps());
ipcMain.handle('stick:uninstall', (_e, { pkg }) => requireStick().uninstallApp(pkg));
ipcMain.handle('stick:reboot', async () => {
  const s = requireStick();
  await s.reboot();
  stick = null; // the session is gone with the reboot; connect again afterwards
  log('Restarting the Fire Stick. Give it about a minute, then connect again.', 'info');
  return { ok: true };
});
ipcMain.handle('stick:androidVersion', () => requireStick().androidVersion());
ipcMain.handle('stick:hasProjectivy', () => requireStick().hasProjectivy());
ipcMain.handle('stick:openProjectivy', () => requireStick().openProjectivy());
ipcMain.handle('stick:enableProjectivy', () => requireStick().enableProjectivy());

ipcMain.handle('stick:enableHomeOnFire', async () => {
  const s = requireStick();
  let apk = null;
  if (!(await s.hasHomeOnFire())) {
    apk = path.join(os.tmpdir(), 'home-on-fire.apk');
    try {
      log('Downloading Home on Fire from GitHub...', 'info');
      await download(HOME_ON_FIRE_APK, apk);
    } catch (e) {
      log(`Download failed: ${e.message}`, 'error');
      return { ok: false, reason: 'download-failed', detail: e.message };
    }
  }
  try {
    return await s.enableHomeOnFire(apk);
  } finally {
    if (apk) fs.rmSync(apk, { force: true });
  }
});

// Lets the person pick an app file from this Mac (Downloads by default).
ipcMain.handle('stick:pickAndInstall', async () => {
  const s = requireStick();
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose an app file',
    defaultPath: path.join(os.homedir(), 'Downloads'),
    properties: ['openFile'],
    filters: [{ name: 'Android app', extensions: ['apk', 'apkm', 'apks', 'xapk'] }],
  });
  if (r.canceled || r.filePaths.length === 0) return { ok: false, reason: 'cancelled' };
  const file = r.filePaths[0];
  log(`Sending ${path.basename(file)} to the Fire Stick... (can take a minute)`, 'info');
  const result = await s.installFile(file);
  log(result.ok ? 'Installed! It is now in Your Apps & Channels on the Fire Stick.' : `Install didn't work: ${result.reason}${result.detail ? ` ${result.detail}` : ''}`, result.ok ? 'ok' : 'error');
  return { ...result, file: path.basename(file) };
});

ipcMain.handle('open:projectivyPage', () => shell.openExternal(PROJECTIVY_PAGE));
ipcMain.handle('open:url', (_e, { url }) => {
  if (/^https:\/\//.test(url)) return shell.openExternal(url);
  return null;
});
ipcMain.handle('open:logs', () => { fs.mkdirSync(logDir, { recursive: true }); return shell.openPath(logDir); });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), locale: app.getLocale(), dataDir, logDir }));

// --- lifecycle -----------------------------------------------------------

app.whenReady().then(() => {
  startRunLog();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => { if (runLog) runLog.end(); });
