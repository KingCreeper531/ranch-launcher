// Finds, installs, updates, opens and uninstalls the apps in catalog.json.
const { app, net } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const catalog = require('./catalog.json');
const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

const state = new Map(); // id -> { installed, version, exePath, uninstall, latest, assetUrl, assetSize, busy, progress, running, error }
let onChange = () => {};
let log = () => {};

function init(opts) {
  onChange = opts.onChange;
  log = opts.log;
  for (const a of catalog) state.set(a.id, {});
}

const emit = (id) => onChange(id, view(id));

function set(id, patch) {
  state.set(id, { ...state.get(id), ...patch });
  emit(id);
}

/** What the window shows for one app. */
function view(id) {
  const a = catalog.find((x) => x.id === id);
  const s = state.get(id) || {};
  return {
    id: a.id, name: a.name, tagline: a.tagline, icon: a.icon, accent: a.accent, repo: a.repo || null,
    comingSoon: !!a.comingSoon,
    installed: !!s.installed, version: s.version || null, latest: s.latest || null,
    updateAvailable: !!(s.installed && s.latest && isNewer(s.latest, s.version)),
    // New version already downloaded and waiting for the app to be closed
    updateReady: !!(s.readyVersion && s.readyVersion === s.latest && s.readyFile && fs.existsSync(s.readyFile)),
    waiting: !!s.waiting,
    running: !!s.running, busy: s.busy || null, progress: s.progress ?? null, error: s.error || null,
    // From the latest GitHub release
    notes: s.notes || '', publishedAt: s.publishedAt || null, size: s.assetSize || 0,
    // What this launcher can do for the app on Windows
    hasSettings: !!a.settings, canUninstall: true,
  };
}

function list() {
  return catalog.map((a) => view(a.id));
}

// ------------------------------------------------------------------ detection
function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

/** Reads Windows' list of installed apps (current user). */
async function installedEntries() {
  const out = await run('reg', ['query', UNINSTALL_KEY, '/s']);
  const entries = [];
  let cur = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('HKEY_')) { cur = { key: line.trim() }; entries.push(cur); continue; }
    const m = /^\s+(\S+)\s+REG_\w+\s+(.*)$/.exec(line);
    if (m && cur) cur[m[1]] = m[2].trim();
  }
  return entries.filter((e) => e.DisplayName);
}

function exeFromEntry(e, exeName) {
  const icon = (e.DisplayIcon || '').replace(/,\d+$/, '').replace(/^"|"$/g, '');
  if (icon && /\.exe$/i.test(icon) && fs.existsSync(icon)) return icon;
  const dir = e.InstallLocation || (e.UninstallString ? path.dirname(e.UninstallString.replace(/^"([^"]+)".*$/, '$1')) : '');
  const guess = dir && path.join(dir, exeName);
  return guess && fs.existsSync(guess) ? guess : null;
}

/** The version stamped into the .exe itself (Windows' installed-apps list can be out of date). */
async function fileVersion(exe) {
  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`]);
  const v = out.trim().match(/^\d+(\.\d+)*/);
  if (!v) return null;
  const parts = v[0].split('.');
  while (parts.length > 3 && parts[parts.length - 1] === '0') parts.pop(); // 1.1.5.0 -> 1.1.5
  return parts.join('.');
}

async function detect() {
  const entries = await installedEntries();
  for (const a of catalog) {
    if (a.comingSoon) continue;
    // "YouTube 1.0.0" is YouTube, but "YouTube Music 1.1.6" is not: only a version may follow the name
    const named = new RegExp(`^${a.uninstallName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s+v?\\d[\\d.]*)?$`);
    // A publisher tells same-named apps apart (this Spotify vs. the official Spotify app)
    const e = entries.find((x) => named.test(x.DisplayName) && (!a.publisher || x.Publisher === a.publisher));
    const exePath = e ? exeFromEntry(e, a.exeName) : null;
    if (e && exePath) {
      set(a.id, {
        installed: true,
        version: (await fileVersion(exePath)) || e.DisplayVersion || (e.DisplayName.match(/(\d+\.\d+\.\d+)/) || [])[1] || null,
        exePath,
        uninstall: e.QuietUninstallString || (e.UninstallString ? `${e.UninstallString} /S` : null),
      });
    } else {
      set(a.id, { installed: false, version: null, exePath: null, uninstall: null });
    }
  }
}

async function checkLatest() {
  for (const a of catalog) {
    if (a.comingSoon || !a.repo) continue;
    try {
      const res = await net.fetch(`https://api.github.com/repos/${a.repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'RanchLauncher' },
      });
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
      const rel = await res.json();
      const asset = (rel.assets || []).find((x) => new RegExp(a.assetPattern, 'i').test(x.name));
      set(a.id, {
        latest: String(rel.tag_name || '').replace(/^v/, '') || null,
        assetUrl: asset ? asset.browser_download_url : null,
        assetSize: asset ? asset.size : 0,
        notes: String(rel.body || '').slice(0, 20000),
        publishedAt: rel.published_at || null,
        error: null,
      });
    } catch (e) {
      log(`Latest version check failed for ${a.name}: ${e.message}`);
    }
  }
}

async function checkRunning() {
  const out = await run('tasklist', ['/FO', 'CSV', '/NH']);
  const names = new Set(out.split(/\r?\n/).map((l) => (l.split('","')[0] || '').replace(/^"/, '').toLowerCase()));
  for (const a of catalog) {
    if (a.comingSoon) continue;
    const running = names.has(String(a.exeName).toLowerCase());
    const s = state.get(a.id);
    if (running !== !!s.running) set(a.id, { running });
    // A downloaded update was waiting for the app to close: install it now
    if (!running && s.waiting && !s.busy) {
      set(a.id, { waiting: false });
      install(a.id);
    }
  }
}

async function refresh() {
  await detect();
  await Promise.all([checkLatest(), checkRunning()]);
}

// ------------------------------------------------------------------ actions
async function download(id) {
  const s = state.get(id);
  if (!s.assetUrl) throw new Error('No Windows download found in the latest release.');
  const dir = path.join(os.tmpdir(), 'ranch-launcher');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, decodeURIComponent(s.assetUrl.split('/').pop()));
  const res = await net.fetch(s.assetUrl, { headers: { 'User-Agent': 'RanchLauncher' } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || s.assetSize || 0;
  const out = fs.createWriteStream(file);
  let done = 0;
  let last = -1;
  const reader = res.body.getReader();
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    out.write(Buffer.from(value));
    done += value.length;
    if (total) {
      const p = Math.floor((done / total) * 100);
      if (p !== last) { last = p; set(id, { progress: p }); }
    }
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  return file;
}

function runInstaller(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(file, ['/S'], { windowsHide: true });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Installer exited with code ${code}`))));
  });
}

/** Downloads the latest version ahead of time (reuses it if already downloaded). */
async function prefetch(id) {
  const s = state.get(id);
  if (s.readyVersion === s.latest && s.readyFile && fs.existsSync(s.readyFile)) return s.readyFile;
  set(id, { busy: 'downloading', progress: 0, error: null });
  try {
    const file = await download(id);
    set(id, { readyFile: file, readyVersion: s.latest });
    log(`Downloaded ${id} v${s.latest}`);
    return file;
  } finally {
    set(id, { busy: null, progress: null });
  }
}

/** Install or update (the installers upgrade in place). */
async function install(id) {
  const s = state.get(id);
  if (s.busy) return;
  try {
    const file = await prefetch(id);
    set(id, { busy: 'finishing', progress: null, waiting: false, error: null });
    await runInstaller(file);
    fs.rm(file, { force: true }, () => {});
    set(id, { readyFile: null, readyVersion: null });
    await detect();
    log(`${s.installed ? 'Updated' : 'Installed'} ${id}`);
  } catch (e) {
    log(`Install failed for ${id}: ${e.message}`);
    set(id, { error: e.message });
  } finally {
    set(id, { busy: null, progress: null });
  }
}

async function uninstall(id) {
  const s = state.get(id);
  if (s.busy || !s.uninstall) return;
  set(id, { busy: 'uninstalling', error: null });
  try {
    await new Promise((resolve, reject) => {
      const p = spawn(s.uninstall, { shell: true, windowsHide: true });
      p.on('error', reject);
      p.on('exit', () => resolve());
    });
    await new Promise((r) => setTimeout(r, 1500)); // the uninstaller finishes in the background
    await detect();
  } catch (e) {
    set(id, { error: e.message });
  } finally {
    set(id, { busy: null });
  }
}

function open(id) {
  const s = state.get(id);
  if (!s.exePath) return;
  spawn(s.exePath, [], { detached: true, stdio: 'ignore', cwd: path.dirname(s.exePath) }).unref();
  setTimeout(checkRunning, 2000);
}

/** Closes a running app so it can be updated or uninstalled. */
async function close(id) {
  const a = catalog.find((x) => x.id === id);
  await run('taskkill', ['/IM', a.exeName, '/T', '/F']);
  await new Promise((r) => setTimeout(r, 800));
  await checkRunning();
}

/**
 * Automatic updates: download every new version as soon as it's out. Install it
 * right away if the app is closed; otherwise install the moment it's closed.
 */
async function autoUpdate() {
  for (const a of catalog) {
    const v = view(a.id);
    if (!v.updateAvailable || v.busy) continue;
    try {
      await prefetch(a.id);
    } catch (e) {
      log(`Auto-download failed for ${a.name}: ${e.message}`);
      set(a.id, { error: `Couldn't download the update: ${e.message}` });
      continue;
    }
    await checkRunning();
    if (state.get(a.id).running) set(a.id, { waiting: true });
    else await install(a.id);
  }
}

// ------------------------------------------------------------------ each app's own settings
// The launcher edits the app's settings file directly; YouTube Music 1.1.6+ picks
// changes up right away, older versions the next time they start.
function settingsPath(a) {
  if (!a.settingsFile) return null;
  if (process.env.RANCH_TEST_SETTINGS_DIR) return path.join(process.env.RANCH_TEST_SETTINGS_DIR, path.basename(a.settingsFile)); // test runs
  return a.settingsFile.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

/**
 * Calls back whenever an app's settings file changes, including changes made in
 * the app itself, so the launcher always shows the current values.
 */
const watchers = new Map();
function watchSettings(onSettingsChanged) {
  for (const a of catalog) {
    const file = settingsPath(a);
    if (!file || watchers.has(a.id)) continue;
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) continue; // app not used yet; tried again on the next refresh
    try {
      let timer = null;
      const w = fs.watch(dir, { persistent: false }, (_event, name) => {
        if (name && name !== path.basename(file)) return;
        clearTimeout(timer);
        timer = setTimeout(() => onSettingsChanged(a.id), 150);
      });
      watchers.set(a.id, w);
    } catch { /* can't watch; the launcher re-reads when the Settings tab opens */ }
  }
}

/** The settings list for an app, with the current value of each. */
function getAppSettings(id) {
  const a = catalog.find((x) => x.id === id);
  if (!a || !a.settings) return null;
  const file = settingsPath(a);
  const saved = file ? readJson(file) : {};
  return {
    file,
    exists: !!(file && fs.existsSync(file)),
    items: a.settings.map((s) => (s.key ? { ...s, value: s.key in saved ? saved[s.key] : s.default } : s)),
  };
}

/** Saves changed settings into the app's settings file, keeping everything else in it. */
function setAppSettings(id, patch) {
  const a = catalog.find((x) => x.id === id);
  const file = a && settingsPath(a);
  if (!file || !patch || typeof patch !== 'object') return getAppSettings(id);
  const allowed = new Map(a.settings.filter((s) => s.key).map((s) => [s.key, s]));
  const current = readJson(file);
  for (const [key, value] of Object.entries(patch)) {
    const s = allowed.get(key);
    if (!s) continue;
    if (s.type === 'toggle') current[key] = !!value;
    else if (s.type === 'text') {
      const v = String(value ?? '').trim();
      if (s.pattern && !new RegExp(s.pattern).test(v)) continue;
      current[key] = v;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.ranch-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(current, null, 2)); // write then swap, so the app never reads half a file
  fs.renameSync(tmp, file);
  log(`Changed ${a.name} settings: ${Object.keys(patch).join(', ')}`);
  return getAppSettings(id);
}

function isNewer(a, b) {
  if (!b) return !!a;
  const x = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

module.exports = {
  init, list, refresh, detect, checkLatest, checkRunning, install, prefetch, uninstall, open, close, autoUpdate, view,
  getAppSettings, setAppSettings, watchSettings,
};
