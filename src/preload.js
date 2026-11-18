const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: data => ipcRenderer.invoke('data:save', data),
  version: () => ipcRenderer.invoke('app:version'),
  dataPath: () => ipcRenderer.invoke('app:dataPath'),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  openFile: p => ipcRenderer.invoke('file:open', p),
  revealFile: p => ipcRenderer.invoke('file:reveal', p),
  filesExist: paths => ipcRenderer.invoke('file:exists', paths),
  scanReports: args => ipcRenderer.invoke('reports:scan', args),
  exportBackup: data => ipcRenderer.invoke('backup:export', data),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: cb => ipcRenderer.on('update:status', (_e, s) => cb(s))
});
