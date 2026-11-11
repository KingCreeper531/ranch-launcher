const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ranch', {
  platform: 'windows',
  list: () => ipcRenderer.invoke('apps:list'),
  refresh: () => ipcRenderer.invoke('apps:refresh'),
  install: (id) => ipcRenderer.invoke('apps:install', id),
  uninstall: (id) => ipcRenderer.invoke('apps:uninstall', id),
  open: (id) => ipcRenderer.invoke('apps:open', id),
  github: (id) => ipcRenderer.invoke('apps:github', id),
  appSettings: (id) => ipcRenderer.invoke('apps:settings-get', id),
  setAppSettings: (id, patch) => ipcRenderer.invoke('apps:settings-set', id, patch),
  // Fires when an app's settings change anywhere (in the app or here); returns an unsubscribe
  onAppSettingsChanged: (fn) => {
    const handler = (_e, id) => fn(id);
    ipcRenderer.on('apps:settings-changed', handler);
    return () => ipcRenderer.removeListener('apps:settings-changed', handler);
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onChanged: (fn) => ipcRenderer.on('apps:changed', (_e, view) => fn(view)),
});
