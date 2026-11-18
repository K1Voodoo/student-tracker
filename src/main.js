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
    reportsPattern: '*{name}*'
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

// ---------- Auto-update via GitHub Releases ----------
function sendUpdate(status, info = {}) {
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
    if (app.isPackaged) {
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);
      setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
    }
  });
  app.on('window-all-closed', () => app.quit());
}
