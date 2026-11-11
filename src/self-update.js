// Keeps the Ranch Launcher itself up to date from its GitHub releases
// (KingCreeper531/ranch-launcher). New versions download in the background;
// they install when you click "Restart to update" or the next time the launcher quits.
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_EVERY_MS = 30 * 60 * 1000;
const FOCUS_GAP_MS = 10 * 60 * 1000;

let state = { status: 'idle', current: app.getVersion(), version: null, percent: null, error: null };
let onState = () => {};
let log = () => {};
let beforeInstall = () => {};
let lastCheck = 0;

function set(patch) {
  state = { ...state, ...patch, current: app.getVersion() };
  onState(state);
}

function init(opts) {
  onState = opts.onChange;
  log = opts.log;
  beforeInstall = opts.beforeInstall;

  autoUpdater.autoDownload = true;          // fetch new versions as soon as they're found
  autoUpdater.autoInstallOnAppQuit = true;  // and install them when the launcher quits
  autoUpdater.logger = { info: () => {}, debug: () => {}, warn: (m) => log(`updater: ${m}`), error: (m) => log(`updater: ${m}`) };

  autoUpdater.on('checking-for-update', () => { if (!['downloading', 'ready'].includes(state.status)) set({ status: 'checking' }); });
  autoUpdater.on('update-not-available', () => set({ status: 'latest', version: null, error: null }));
  autoUpdater.on('update-available', (info) => { log(`Launcher update available: ${info.version}`); set({ status: 'downloading', version: info.version, percent: 0, error: null }); });
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => { log(`Launcher update ${info.version} downloaded`); set({ status: 'ready', version: info.version, percent: null }); });
  autoUpdater.on('error', (err) => {
    const msg = String(err?.message || err).split('\n')[0];
    log(`Launcher update error: ${msg}`);
    // A failed check isn't worth a button; a failed download keeps a Retry option
    set(state.version ? { status: 'error', error: msg } : { status: 'idle' });
  });

  if (!app.isPackaged) {
    // Developer preview of the button: RANCH_FAKE_UPDATE=ready|downloading|available npm start
    const fake = process.env.RANCH_FAKE_UPDATE;
    if (fake) set({ status: fake, version: '9.9.9', percent: fake === 'downloading' ? 42 : null });
    return;
  }
  setTimeout(check, 6000);
  setInterval(check, CHECK_EVERY_MS);
  app.on('browser-window-focus', () => { if (Date.now() - lastCheck > FOCUS_GAP_MS) check(); });
}

function check() {
  if (!app.isPackaged || ['downloading', 'ready'].includes(state.status)) return Promise.resolve(state);
  lastCheck = Date.now();
  return autoUpdater.checkForUpdates().then(() => state).catch(() => state);
}

/** "Restart to update" (or retry a failed download). */
function install() {
  if (state.status === 'ready') {
    beforeInstall();
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  } else if (state.status === 'error' || state.status === 'available') {
    set({ status: 'downloading', percent: 0, error: null });
    autoUpdater.downloadUpdate().catch(() => {});
  }
}

module.exports = { init, check, install, getState: () => state };
