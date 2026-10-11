const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hub', {
  call: (action, value) => ipcRenderer.invoke('hub:action', action, value),
  onState: callback => ipcRenderer.on('hub:state', (_event, state) => callback(state)),
});
