const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('exportProgress', {
  onState: callback => ipcRenderer.on('export:progress', (_event, value) => callback(value)),
  stop: requestId => ipcRenderer.invoke('export:stop', requestId),
});
