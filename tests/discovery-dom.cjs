const { app, BrowserWindow, session } = require('electron');
const { Bridge } = require('../src/bridge.cjs'); const { attachDiscovery } = require('../src/discovery-session.cjs');
let bridge;
app.whenReady().then(async () => {
  bridge = await new Bridge().start(); const port = await bridge.startDiscovery(0);
  const sandbox = session.fromPartition('discovery-test-' + Date.now());
  // Serve only synthetic fixtures; do not access the user's EDA account or the network site.
  sandbox.protocol.handle('https', () => new Response('<html><body>Discovery fixture</body></html>', { headers: { 'Content-Type': 'text/html' } }));
  const eda = new BrowserWindow({ show: false, webPreferences: { session: sandbox, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const other = new BrowserWindow({ show: false, webPreferences: { session: sandbox, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const url = attachDiscovery(eda.webContents, bridge, port);
  await eda.loadURL('https://pro.lceda.cn/editor'); await other.loadURL('https://www.szlcsc.com/');
  const fetchInfo = `fetch(${JSON.stringify(url)}).then(async response => ({code:response.status, body:await response.text()})).catch(error => ({error:error.message}))`;
  const info = await eda.webContents.executeJavaScript(fetchInfo);
  if (info.code !== 200 || JSON.parse(info.body).uri !== bridge.uri) throw new Error('EDA discovery failed: ' + JSON.stringify(info));
  const denied = await other.webContents.executeJavaScript(fetchInfo);
  if (denied.code === 200 || denied.body?.includes(bridge.token)) throw new Error('Shop view received discovery credentials');
  console.log('DISCOVERY_DOM_OK Embedded EDA connected; shop view denied');
  eda.destroy(); other.destroy(); bridge.close(); app.quit();
}).catch(error => { console.error(error); bridge?.close(); app.exit(1); });
