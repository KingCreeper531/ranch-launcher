const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const apps = require('./apps');

app.setAppUserModelId('local.ranch.launcher');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion'); // keep drawing when covered
if (process.env.RANCH_USER_DATA) app.setPath('userData', process.env.RANCH_USER_DATA); // test runs
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const ICON = path.join(__dirname, '..', 'build', 'icon.png');
let win = null;
let tray = null;
let quitting = false;

// ------------------------------------------------------------------ settings
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { autoUpdate: true, closeToTray: true, startWithWindows: false };
let settings = null;
function getSettings() {
  if (!settings) {
    try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { settings = { ...DEFAULTS }; }
  }
  return settings;
}
function setSettings(patch) {
  settings = { ...getSettings(), ...patch };
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { /* ignore */ }
  if ('startWithWindows' in patch && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: !!settings.startWithWindows, args: ['--hidden'] });
  }
  return settings;
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'launcher.log'), line); } catch { /* ignore */ }
}

// ------------------------------------------------------------------ window
function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    title: 'Ranch Launcher',
    icon: ICON,
    backgroundColor: '#17120e',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'ui', 'index.html')); // built from renderer/ by Vite
  win.once('ready-to-show', () => { if (show) win.show(); });
  win.on('close', (e) => {
    if (!quitting && getSettings().closeToTray) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function showWindow() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ------------------------------------------------------------------ tray
function updateTray() {
  if (!tray) return;
  const items = apps.list().filter((a) => a.installed).map((a) => ({ label: `Open ${a.name}`, click: () => apps.open(a.id) }));
  tray.setContextMenu(Menu.buildFromTemplate([
    ...items,
    ...(items.length ? [{ type: 'separator' }] : []),
    { label: 'Show Ranch Launcher', click: showWindow },
    { label: 'Check for updates', click: () => refreshAll(true) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ------------------------------------------------------------------ actions that may need the app closed first
async function closeIfRunning(id, verb) {
  const v = apps.view(id);
  if (!v.running) return true;
  const { response } = await dialog.showMessageBox(win || undefined, {
    type: 'question',
    title: 'Ranch Launcher',
    message: `${v.name} is open.`,
    detail: `Close it to ${verb}?`,
    buttons: [`Close and ${verb}`, 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return false;
  await apps.close(id);
  return true;
}

// Keep the launcher's view of each app's settings in sync with the app
const watchAppSettings = () => apps.watchSettings((id) => win?.webContents.send('apps:settings-changed', id));

async function refreshAll(andUpdate = false) {
  await apps.refresh();
  watchAppSettings(); // picks up apps whose settings folder appeared since last time
  updateTray();
  if (process.env.RANCH_NO_INSTALL) return; // developer test runs never install anything
  if (andUpdate || getSettings().autoUpdate) await apps.autoUpdate();
}

// ------------------------------------------------------------------ IPC
ipcMain.handle('apps:list', () => apps.list());
ipcMain.handle('apps:refresh', () => refreshAll(false).then(() => apps.list()));
ipcMain.handle('apps:install', async (_e, id) => {
  const v = apps.view(String(id));
  if (v.comingSoon) return;
  if (v.installed && !(await closeIfRunning(v.id, 'update'))) return;
  await apps.install(v.id);
  updateTray();
});
ipcMain.handle('apps:uninstall', async (_e, id) => {
  const v = apps.view(String(id));
  const { response } = await dialog.showMessageBox(win || undefined, {
    type: 'warning',
    title: 'Ranch Launcher',
    message: `Uninstall ${v.name}?`,
    detail: 'Its settings and sign-in stay on this PC, so reinstalling picks up where you left off.',
    buttons: ['Uninstall', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return;
  if (!(await closeIfRunning(v.id, 'uninstall'))) return;
  await apps.uninstall(v.id);
  updateTray();
});
ipcMain.handle('apps:open', (_e, id) => apps.open(String(id)));
ipcMain.handle('apps:github', (_e, id) => {
  const v = apps.view(String(id));
  if (v.repo) shell.openExternal(`https://github.com/${v.repo}/releases`);
});
// Each app's own settings (edited in the launcher, saved into the app's settings file)
ipcMain.handle('apps:settings-get', (_e, id) => apps.getAppSettings(String(id)));
ipcMain.handle('apps:settings-set', (_e, id, patch) => apps.setAppSettings(String(id), patch));
const SETTING_ROWS = [
  { key: 'autoUpdate', title: 'Keep apps up to date', help: 'Downloads each new version as soon as it is released. It installs straight away, or the moment you close the app if it is open.' },
  { key: 'startWithWindows', title: 'Start with Windows', help: 'Opens in the tray when you sign in, so updates keep coming.' },
  { key: 'closeToTray', title: 'Close to tray', help: 'Closing the window keeps the launcher running in the tray.' },
];
ipcMain.handle('settings:get', () => ({ ...getSettings(), version: app.getVersion(), rows: SETTING_ROWS }));
ipcMain.handle('settings:set', (_e, patch) => {
  const allowed = {};
  for (const k of Object.keys(DEFAULTS)) if (k in (patch || {})) allowed[k] = !!patch[k];
  return setSettings(allowed);
});

// ------------------------------------------------------------------ lifecycle
app.on('second-instance', showWindow);

app.whenReady().then(async () => {
  apps.init({
    log,
    onChange: (id, view) => win?.webContents.send('apps:changed', view),
  });
  createWindow(!process.argv.includes('--hidden'));
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Ranch Launcher');
  tray.on('click', showWindow);
  updateTray();

  await refreshAll(false);
  // Keep an eye on things: what's running (so waiting updates install the moment
  // an app is closed) and new versions (every 15 minutes, downloaded right away).
  setInterval(() => apps.checkRunning(), 4000);
  setInterval(() => refreshAll(false), 15 * 60 * 1000);
  log(`Ranch Launcher ${app.getVersion()} started`);
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (quitting || !getSettings().closeToTray) app.quit(); });
