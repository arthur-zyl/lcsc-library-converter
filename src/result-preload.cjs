const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('exportResult', {
  onState: callback => ipcRenderer.on('result:state', (_event, value) => callback(value)),
  choose: (id, choice) => ipcRenderer.send('result:choose', { id, choice }),
});
