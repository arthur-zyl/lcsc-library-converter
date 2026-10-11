const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path'); const fs = require('node:fs/promises');
const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(app.getPath('temp'), 'hub-cart-ui-' + require('node:crypto').randomUUID()));
app.whenReady().then(async () => {
  const { parseDetails } = require('../src/product-details.cjs');
  const sample = parseDetails(await fs.readFile(path.join(__dirname, 'fixtures/C5137636.html'), 'utf8'), 'C5137636', 'https://item.szlcsc.com/5747088.html');
  const state = { queue: [sample,
    { id: 'C5205141', name: 'C5205141', description: '' }], resources: [], page: 'queue', processing: false, bridge: { connected: true, active: null }, logs: [], navigation: {} };
  const win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { offscreen: true, preload: path.join(root, 'src/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.setMenu(null);
  let retryId,exportRequest;state.exportItemResults={kicad:{C5205141:{status:'failed',label:'失败',message:'焊盘尺寸超出支持范围'}}};state.lastExportSummary={target:'kicad',items:[{id:'C1',name:'成功元件',status:'converted',label:'成功',message:'完成'}]};
  ipcMain.handle('hub:action', (_event, action, value) => {
    if (action === 'state') return state;
    if (action === 'export-check')return {ok:true};if(action==='export')exportRequest=value;
    if (action === 'remove') state.queue = state.queue.filter(x => x.id !== value);
    if (action === 'clear') state.queue = [];
    if (action === 'details') retryId = value;
    win.webContents.send('hub:state', state); return { ok: true };
  });
  await win.loadFile(path.join(root, 'ui/index.html')); await new Promise(resolve => setTimeout(resolve, 300));
  const checks = await win.webContents.executeJavaScript(`({ rows:document.querySelectorAll('.cart-item').length, visible:document.getElementById('cart').getBoundingClientRect().width>0, toolbarHidden:document.querySelector('.toolbar').hidden, brand:document.querySelector('.product-spec').textContent, header:getComputedStyle(document.querySelector('header')).backgroundColor, aside:!!document.querySelector('#cart aside') })`);
  if (checks.rows !== 2 || !checks.visible || !checks.toolbarHidden || checks.aside || !checks.brand.includes('FOJAN') || checks.header !== 'rgb(23, 57, 75)') throw new Error('Cart layout failed: ' + JSON.stringify(checks));
  if (await win.webContents.executeJavaScript("!!document.querySelector('footer,#add-form,.hint,#stop') || document.body.textContent.includes('暂无封装信息')") ) throw new Error('Removed controls or empty metadata labels remain');
  if (!await win.webContents.executeJavaScript("document.querySelectorAll('.product-parameters>div').length === 5 && document.body.textContent.includes('额定电压50V') && document.body.textContent.includes('工作温度-55℃~+125℃') && document.body.textContent.includes('4000个/圆盘')")) throw new Error('Engineering parameters or pack size missing');
  if (!await win.webContents.executeJavaScript("!document.querySelector('#connection svg,#connection button,#cart .page-heading,details.product-description') && document.getElementById('connection').tagName === 'SPAN' && document.getElementById('connection').dataset.status === 'connected' && document.querySelector('.product-heading strong') && document.querySelector('.product-description').title === document.querySelector('.product-description').textContent && getComputedStyle(document.querySelector('.product-description')).textOverflow === 'ellipsis'")) throw new Error('Simplified status or truncated description missing');
  if(!await win.webContents.executeJavaScript("document.querySelector('.item-result').textContent.includes('焊盘尺寸') && !document.getElementById('last-results').hidden && document.getElementById('last-results-items').textContent.includes('成功元件')"))throw new Error('Per-part result or success summary missing');
  await win.webContents.executeJavaScript("[...document.querySelectorAll('.row-actions button')].find(b=>b.textContent==='重试').click()");await new Promise(r=>setTimeout(r,100));if(exportRequest?.ids?.join(',')!=='C5205141')throw new Error('Individual retry exported the entire queue');
  win.setSize(1060, 800); await new Promise(resolve=>setTimeout(resolve,100));
  if (!await win.webContents.executeJavaScript("[...document.querySelectorAll('.cart-item,header,.product-parameters')].every(node=>node.scrollWidth <= node.clientWidth+1)")) throw new Error('Layout overflows minimum window width');
  win.setSize(1440, 960); await new Promise(resolve=>setTimeout(resolve,100));
  if (process.env.HUB_UI_PREVIEW) {
    const image = await win.webContents.executeJavaScript("Promise.race([Promise.all([...document.images].map(img => img.complete ? Promise.resolve({ok:img.naturalWidth>0}) : new Promise(resolve => {img.addEventListener('load',()=>resolve({ok:true}),{once:true});img.addEventListener('error',()=>resolve({ok:false}),{once:true});}))), new Promise(resolve=>setTimeout(()=>resolve('image timeout'),5000))])");
    console.log('IMAGE_CHECK ' + JSON.stringify(image));
    await fs.writeFile(process.env.HUB_UI_PREVIEW, (await win.webContents.capturePage()).toPNG());
  }
  for (const [login, connected, banner, message] of [['signed-in',true,false,''],['unknown',true,false,''],['signed-in',false,true,'连接插件未连接'],['signed-out',false,true,'EDA 未登录']]) {
    state.edaLogin=login; state.bridge.connected=connected; win.webContents.send('hub:state',state); await new Promise(resolve=>setTimeout(resolve,50));
    const actual=await win.webContents.executeJavaScript("({visible:!document.getElementById('login-banner').hidden,text:document.getElementById('login-message').textContent})");
    if(actual.visible!==banner || banner && !actual.text.includes(message)) throw new Error('Login/plugin status conflated: '+JSON.stringify({login,connected,actual}));
  }
  state.edaLogin='signed-in'; state.bridge.connected=true; win.webContents.send('hub:state',state); await new Promise(resolve=>setTimeout(resolve,50));
  state.metadata = { C5137636: {status:'loading'} }; win.webContents.send('hub:state', state); await new Promise(resolve=>setTimeout(resolve,50));
  if (!await win.webContents.executeJavaScript("document.querySelector('.metadata-progress')?.textContent.includes('正在读取')")) throw new Error('Metadata progress missing');
  state.metadata.C5137636 = {status:'error',message:'Timeout'}; win.webContents.send('hub:state', state); await new Promise(resolve=>setTimeout(resolve,50));
  await win.webContents.executeJavaScript("document.querySelector('.metadata-error button').click()"); await new Promise(resolve=>setTimeout(resolve,50));
  if (retryId !== 'C5137636') throw new Error('Metadata retry did not target the correct part');
  await win.webContents.executeJavaScript("document.querySelector('.row-actions button:last-child').click()");
  await new Promise(resolve => setTimeout(resolve, 50));
  if (await win.webContents.executeJavaScript("document.querySelectorAll('.cart-item').length") !== 1) throw new Error('Remove action failed');
  await win.webContents.executeJavaScript("document.getElementById('clear').click()"); await new Promise(resolve => setTimeout(resolve, 50));
  if (await win.webContents.executeJavaScript("document.querySelectorAll('.cart-item').length === 1 && document.getElementById('clear-dialog').open") !== true) throw new Error('Clear action must await confirmation');
  await win.webContents.executeJavaScript("document.getElementById('clear-cancel').click()");
  if (await win.webContents.executeJavaScript("document.querySelectorAll('.cart-item').length === 1 && !document.getElementById('clear-dialog').open") !== true) throw new Error('Cancel must preserve the list');
  await win.webContents.executeJavaScript("document.getElementById('clear').click(); document.getElementById('clear-confirm').click()"); await new Promise(resolve => setTimeout(resolve, 50));
  if (await win.webContents.executeJavaScript("document.querySelectorAll('.cart-item').length") !== 0) throw new Error('Clear action failed');
  console.log('CART_UI_OK layout, metadata, remove and clear'); win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
