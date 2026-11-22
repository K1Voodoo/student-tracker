const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let win;

// ---------- Data storage (lives only on this computer, never in the repo) ----------
const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'data.json');

const DEFAULT_DATA = {
  students: [],
  settings: {
    bgColor: '#f6f7fb',
    lineColor: '#d5d9e2',
    textColor: '#1f2430',
    reportsFolder: '',
    reportsPattern: '*{name}*',
    backupEnabled: false,
    backupDestinations: [],
    backupKeep: 30
  }
};

function loadData() {
  try {
    const raw = fs.readFileSync(dataFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      students: Array.isArray(parsed.students) ? parsed.students : [],
      settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) }
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

function saveData(data) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const file = dataFile();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dataDir(), 'data.backup.json'));
  fs.renameSync(tmp, file);
  return true;
}

// ---------- Backups (daily, to local and cloud-synced folders) ----------
// Cloud services are used through their desktop sync folders: a file saved in
// the OneDrive / Google Drive / Dropbox folder is uploaded by that app.
const backupStateFile = () => path.join(dataDir(), 'backup-state.json');
const BACKUP_RX = /^student-tracker-backup-\d{4}-\d{2}-\d{2}\.json$/;

function readBackupState() {
  try { return JSON.parse(fs.readFileSync(backupStateFile(), 'utf8')); } catch { return {}; }
}
function writeBackupState(st) {
  try { fs.writeFileSync(backupStateFile(), JSON.stringify(st, null, 2), 'utf8'); } catch {}
}
function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function runBackup(reason) {
  const data = loadData();
  const dests = (data.settings.backupDestinations || []).filter(Boolean);
  const keep = Math.max(1, parseInt(data.settings.backupKeep, 10) || 30);
  const fileName = `student-tracker-backup-${localDate()}.json`;
  const json = JSON.stringify(data, null, 2);
  const results = [];

  for (const dest of dests) {
    try {
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, fileName), json, 'utf8');
      // keep only the newest `keep` daily backups in this folder
      const old = fs.readdirSync(dest).filter(f => BACKUP_RX.test(f)).sort().reverse().slice(keep);
      for (const f of old) { try { fs.unlinkSync(path.join(dest, f)); } catch {} }
      results.push({ dest, ok: true });
    } catch (e) {
      results.push({ dest, ok: false, error: e.message });
    }
  }

  const ok = results.length > 0 && results.every(r => r.ok);
  const st = readBackupState();
  st.lastRun = new Date().toISOString();
  st.lastResults = results;
  st.reason = reason;
  if (ok) st.lastSuccessDate = localDate();
  writeBackupState(st);
  const payload = { ok, results, lastRun: st.lastRun, reason, error: results.length ? null : 'No backup folder selected' };
  if (win && !win.isDestroyed()) win.webContents.send('backup:done', payload);
  return payload;
}

function dailyBackupCheck() {
  const data = loadData();
  if (!data.settings.backupEnabled || !(data.settings.backupDestinations || []).length) return;
  if (readBackupState().lastSuccessDate === localDate()) return;
  runBackup('daily');
}

function detectCloudFolders() {
  const home = app.getPath('home');
  const env = process.env;
  const found = [];
  const add = (id, name, p) => {
    if (p && fs.existsSync(p) && !found.some(f => f.path.toLowerCase() === p.toLowerCase())) found.push({ id, name, path: p });
  };

  // OneDrive (personal and work/school)
  add('onedrive', 'OneDrive', env.OneDriveConsumer);
  add('onedrive', 'OneDrive (work/school)', env.OneDriveCommercial);
  add('onedrive', 'OneDrive', env.OneDrive);
  add('onedrive', 'OneDrive', path.join(home, 'OneDrive'));

  // Google Drive for desktop: a virtual drive letter with "My Drive" inside
  for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
    for (const sub of ['My Drive', 'Moja disk', 'Moj disk']) add('gdrive', 'Google Drive', `${letter}:\\${sub}`);
  }
  add('gdrive', 'Google Drive', path.join(home, 'Google Drive'));
  add('gdrive', 'Google Drive', path.join(home, 'My Drive'));

  // Dropbox (location is written in info.json)
  for (const base of [env.APPDATA, env.LOCALAPPDATA]) {
    if (!base) continue;
    try {
      const info = JSON.parse(fs.readFileSync(path.join(base, 'Dropbox', 'info.json'), 'utf8'));
      if (info.personal) add('dropbox', 'Dropbox', info.personal.path);
      if (info.business) add('dropbox', 'Dropbox (business)', info.business.path);
    } catch {}
  }
  add('dropbox', 'Dropbox', path.join(home, 'Dropbox'));

  // iCloud Drive, Box, MEGA, pCloud
  add('icloud', 'iCloud Drive', path.join(home, 'iCloudDrive'));
  add('box', 'Box', path.join(home, 'Box'));
  add('mega', 'MEGA', path.join(home, 'MEGA'));
  add('mega', 'MEGA', path.join(home, 'Documents', 'MEGA'));
  add('pcloud', 'pCloud', 'P:\\');

  return found;
}

// ---------- Reports: scan a folder for files matching a name pattern ----------
function patternToRegex(pattern, name) {
  const esc = s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const parts = pattern.split('{name}').map(p => esc(p).replace(/\*/g, '.*').replace(/\?/g, '.'));
  const namePart = esc(name.trim()).replace(/\s+/g, '[\\s_.-]+');
  return new RegExp('^' + parts.join(namePart) + '$', 'i');
}

function walk(dir, depth, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) walk(full, depth - 1, out); }
    else if (!e.name.startsWith('~$')) out.push(full);
  }
}

function scanReports(folder, pattern, names) {
  const result = {};
  names.forEach(n => (result[n] = []));
  if (!folder || !fs.existsSync(folder)) return result;
  const files = [];
  walk(folder, 3, files);
  for (const n of names) {
    if (!n || !n.trim()) continue;
    const rx = patternToRegex(pattern || '*{name}*', n);
    result[n] = files
      .filter(f => rx.test(path.basename(f)) || rx.test(path.parse(f).name))
      .map(f => {
        let mtime = 0;
        try { mtime = fs.statSync(f).mtimeMs; } catch {}
        return { path: f, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }
  return result;
}

// ---------- Window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 900,
    minHeight: 500,
    title: 'Student Tracker',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ---------- IPC ----------
ipcMain.handle('data:load', () => loadData());
ipcMain.handle('data:save', (_e, data) => saveData(data));
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:dataPath', () => dataFile());

ipcMain.handle('files:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Add documents',
    properties: ['openFile', 'multiSelections']
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('folder:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Select reports folder', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('file:open', async (_e, p) => {
  if (!fs.existsSync(p)) return 'File not found: ' + p;
  return shell.openPath(p); // '' on success, error message otherwise
});
ipcMain.handle('file:reveal', (_e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle('file:exists', (_e, paths) => paths.map(p => fs.existsSync(p)));

ipcMain.handle('reports:scan', (_e, { folder, pattern, names }) => scanReports(folder, pattern, names));

// A student's own reports folder: every file in it (and up to 3 subfolder levels)
ipcMain.handle('reports:listFolder', (_e, folder) => {
  if (!folder || !fs.existsSync(folder)) return { exists: false, files: [] };
  const files = [];
  walk(folder, 3, files);
  return {
    exists: true,
    files: files.map(f => {
      let mtime = 0;
      try { mtime = fs.statSync(f).mtimeMs; } catch {}
      return { path: f, mtime };
    }).sort((a, b) => b.mtime - a.mtime)
  };
});

// "Connect account": cloud storage is connected on Windows through each
// provider's desktop app (sign in once, it syncs a folder). OneDrive is built
// into Windows, so start it; for the others open the official download page.
const CLOUD_CONNECT = {
  onedrive: 'https://www.microsoft.com/microsoft-365/onedrive/download',
  gdrive: 'https://www.google.com/drive/download/',
  dropbox: 'https://www.dropbox.com/install',
  icloud: 'https://apps.microsoft.com/detail/9PKTQ5699M62',
  box: 'https://www.box.com/resources/downloads',
  mega: 'https://mega.io/desktop',
  pcloud: 'https://www.pcloud.com/download-free-online-cloud-file-storage.html'
};
ipcMain.handle('cloud:connect', async (_e, id) => {
  if (id === 'onedrive') {
    const exe = [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'OneDrive', 'OneDrive.exe'),
      path.join(process.env.ProgramFiles || '', 'Microsoft OneDrive', 'OneDrive.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft OneDrive', 'OneDrive.exe')
    ].find(p => fs.existsSync(p));
    if (exe) { await shell.openPath(exe); return 'app'; }
  }
  const url = CLOUD_CONNECT[id];
  if (!url) return 'unknown';
  await shell.openExternal(url);
  return 'web';
});

ipcMain.handle('backup:export', async (_e, data) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export backup',
    defaultPath: `student-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled) return false;
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf8');
  return true;
});
ipcMain.handle('backup:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import backup',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled) return null;
  return JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
});

ipcMain.handle('backup:run', () => runBackup('manual'));
ipcMain.handle('backup:state', () => readBackupState());
ipcMain.handle('cloud:detect', () => detectCloudFolders());
ipcMain.handle('folder:ensure', (_e, p) => {
  try { fs.mkdirSync(p, { recursive: true }); return true; } catch (e) { return e.message; }
});
ipcMain.handle('folder:pickAny', async (_e, title) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'Select folder', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// ---------- Auto-update via GitHub Releases ----------
function sendUpdate(status, info = {}) {
  console.log('[update]', status, JSON.stringify(info));
  if (win && !win.isDestroyed()) win.webContents.send('update:status', { status, ...info });
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('checking-for-update', () => sendUpdate('checking'));
autoUpdater.on('update-available', i => sendUpdate('available', { version: i.version, notes: i.releaseNotes }));
autoUpdater.on('update-not-available', i => sendUpdate('none', { version: i.version }));
autoUpdater.on('download-progress', p => sendUpdate('progress', { percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', i => sendUpdate('downloaded', { version: i.version }));
autoUpdater.on('error', err => sendUpdate('error', { message: String(err && err.message || err) }));

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) { sendUpdate('dev'); return; }
  try { await autoUpdater.checkForUpdates(); } catch (e) { sendUpdate('error', { message: e.message }); }
});
ipcMain.handle('update:download', async () => {
  try { await autoUpdater.downloadUpdate(); } catch (e) { sendUpdate('error', { message: e.message }); }
});
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall(false, true));

// ---------- App lifecycle ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    createWindow();
    // daily backup: shortly after start, then checked every 30 minutes
    setTimeout(dailyBackupCheck, 10 * 1000);
    setInterval(dailyBackupCheck, 30 * 60 * 1000);
    if (app.isPackaged) {
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);
      setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
    }
  });
  app.on('window-all-closed', () => app.quit());
}
