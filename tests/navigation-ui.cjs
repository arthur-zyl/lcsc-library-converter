const {app,BrowserWindow,WebContentsView,ipcMain}=require('electron');
const {once}=require('node:events'),path=require('node:path'),assert=require('node:assert/strict');
const {navigationController}=require('../src/browser-navigation.cjs');
app.setPath('userData',path.join(app.getPath('temp'),'hub-nav-'+require('node:crypto').randomUUID()));
app.whenReady().then(async()=>{
 const root=path.resolve(__dirname,'..'),win=new BrowserWindow({show:false,width:1100,height:720,webPreferences:{preload:path.join(root,'src/preload.cjs'),sandbox:true,contextIsolation:true}});
 const view=new WebContentsView({webPreferences:{partition:'nav-test'}});win.contentView.addChildView(view);
 view.webContents.session.protocol.handle('https',()=>new Response('<html><body>Navigation test</body></html>',{headers:{'content-type':'text/html'}}));
 const state={locale:"zh-CN",queue:[],logs:[],page:'eda',bridge:{connected:false},edaLogin:'signed-in',navigation:{available:true,back:false,forward:false},settings:{}};
 const send=()=>win.webContents.send('hub:state',state);let prompts=0;
 const nav=navigationController(view.webContents,{error:m=>{throw new Error(m);},blocked:r=>{prompts++;state.navigationConfirmation={...r,provider:'eda'};view.setVisible(false);send();}});
 const calls=[];ipcMain.handle('hub:action',async(_event,action,value)=>{
  calls.push(action);if(action==='state')return state;
  if(action==='navigation-confirm'){nav.confirm(value.id,value.accepted);state.navigationConfirmation=null;view.setVisible(true);send();}
  else if(['back','forward','refresh'].includes(action))nav.perform(action);
  else if(action==='open-login')nav.perform('navigate','https://pro.lceda.cn/editor');
  return {ok:true};
 });
 await win.loadFile(path.join(root,'ui/index.html'));await view.webContents.loadURL('https://pro.lceda.cn/first');await view.webContents.loadURL('https://pro.lceda.cn/second');
 const update=()=>{state.navigation={url:view.webContents.getURL(),available:true,back:view.webContents.navigationHistory.canGoBack(),forward:view.webContents.navigationHistory.canGoForward()};send();};
 const pause=()=>new Promise(r=>setTimeout(r,100)),js=s=>win.webContents.executeJavaScript(s),click=id=>js(`document.getElementById('${id}').click()`);
 update();await pause();assert.equal(await js('document.querySelector(".toolbar").hidden'),false);
 let loaded=once(view.webContents,'did-finish-load');await click('back');await loaded;assert.equal(view.webContents.getURL(),'https://pro.lceda.cn/first');update();await pause();
 loaded=once(view.webContents,'did-finish-load');await click('forward');await loaded;assert.equal(view.webContents.getURL(),'https://pro.lceda.cn/second');
 await view.webContents.executeJavaScript('window.onbeforeunload=()=>false;true',true);
 await click('refresh');await pause();assert.equal(prompts,1);assert.equal(await js('document.getElementById("navigation-dialog").open'),true);
 await click('navigation-cancel');await pause();assert.equal(view.webContents.getURL(),'https://pro.lceda.cn/second');assert.equal(await js('document.getElementById("navigation-dialog").open'),false);
 await click('refresh');await pause();assert.equal(prompts,2);loaded=once(view.webContents,'did-finish-load');await click('navigation-confirm');await loaded;assert.equal(view.webContents.getURL(),'https://pro.lceda.cn/second');
 loaded=once(view.webContents,'did-finish-load');await click('open-login');await loaded;assert.equal(view.webContents.getURL(),'https://pro.lceda.cn/editor');
 assert.ok(calls.includes('back')&&calls.includes('forward')&&calls.includes('refresh')&&calls.includes('open-login'));
 console.log('NAVIGATION_UI_OK history, refresh, beforeunload cancel/confirm, disconnected toolbar, EDA home');app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
setTimeout(()=>{console.error('Navigation test timed out');app.exit(1);},25000).unref();
