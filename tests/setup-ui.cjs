const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');app.setPath('userData',path.join(app.getPath('temp'),'hub-setup-ui-'+require('node:crypto').randomUUID()));
app.whenReady().then(async()=>{
  const {DEFAULT}=require('../src/power-pin-rules.cjs');
  const state={queue:[],logs:[],page:'setup',edaLogin:'signed-out',bridge:{connected:false},navigation:{},settings:{freecadPython:'',kicadCli:'',cadenceRoot:'',kicadDir:'E:/Libraries/KiCad',cadenceDir:'E:/Libraries/Cadence',altiumDir:'E:/Libraries/AD',kicadFootprintLibraryName:'LCSC',cadenceLibraryName:'LCSC',altiumLibraryName:'LCSC',cadencePowerRules:DEFAULT}};
  const win=new BrowserWindow({show:false,width:1060,height:720,webPreferences:{offscreen:true,preload:path.join(root,'src/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  let saved,download;let failSave=true;
  const send=()=>win.webContents.send('hub:state',state);
  ipcMain.handle('hub:action',async(_event,action,value)=>{
    if(action==='state')return state;
    if(action==='page'){state.page=value;send();}
    if(action==='setup-download')download=value;
    if(action==='setup-detect')return {ok:true,freecadPython:'D:/FreeCAD 1.1/bin/python.exe',kicadCli:'D:/KiCad/9/bin/kicad-cli.exe',cadenceRoot:'D:/Cadence/SPB_25.1'};
    if(action==='settings-detect')return {ok:true,path:value==='cadenceRoot'?'D:/Cadence/SPB_25.1':'D:/KiCad/9/bin/kicad-cli.exe'};
    if(action==='settings-pick')return {ok:true,path:null};
    if(action==='setup-check')return value.freecadPython?{ok:true,message:'可用'}:{ok:false,message:'请安装 FreeCAD'};
    if(action==='setup-save'){if(failSave)return {ok:false,message:'目录无法写入'};saved=value;Object.assign(state.settings,value);state.exportTarget=value.target;send();}
    if(action==='open-login'){state.page='eda';send();}
    if(action==='setup-finish'){state.setupCompleted=true;state.page='shop';send();}
    return {ok:true};
  });
  await win.loadFile(path.join(root,'ui/index.html'));const pause=()=>new Promise(r=>setTimeout(r,100));await pause();
  const js=code=>win.webContents.executeJavaScript(code);const click=id=>js(`document.getElementById('${id}').click()`);
  const shots=process.argv.find(x=>x.startsWith('--screenshots='));async function shot(name){if(shots){await pause();await fs.writeFile(path.join(shots.slice(14),name+'.png'),(await win.webContents.capturePage()).toPNG());}}
  assert.ok(await js("!document.getElementById('setup').hidden && document.getElementById('settings').hidden"));await shot('freecad');
  await click('setup-next');await pause();assert.ok(await js("document.getElementById('setup-message').textContent.includes('安装 FreeCAD') && !document.querySelector('[data-setup-panel="+'"0"'+"]').hidden"));
  await click('setup-download-freecad');await pause();assert.equal(download,'freecad');
  await click('setup-detect');await pause();await click('setup-next');await pause();assert.ok(await js("!document.querySelector('[data-setup-panel="+'"1"'+"]').hidden"));await shot('kicad');
  await js("document.getElementById('setup-output').value='E:/CustomKiCad';document.getElementById('setup-target').value='altium';document.getElementById('setup-target').dispatchEvent(new Event('change'))");
  assert.ok(await js("document.getElementById('setup-tool-field').hidden && document.getElementById('setup-output').value==='E:/Libraries/AD'"));await shot('altium');
  await js("document.getElementById('setup-target').value='kicad';document.getElementById('setup-target').dispatchEvent(new Event('change'))");assert.equal(await js("document.getElementById('setup-output').value"),'E:/CustomKiCad');
  await js("document.getElementById('setup-target').value='cadence';document.getElementById('setup-target').dispatchEvent(new Event('change'))");await shot('cadence');await js("document.getElementById('setup-tool').value=''");await click('setup-tool-detect');await pause();assert.equal(await js("document.getElementById('setup-tool').value"),'D:/Cadence/SPB_25.1');
  await click('setup-next');await pause();assert.ok(await js("document.getElementById('setup-message').textContent.includes('目录无法写入')"));assert.equal(saved,undefined);
  failSave=false;await click('setup-next');await pause();assert.equal(saved.target,'cadence');assert.equal(saved.cadenceRoot,'D:/Cadence/SPB_25.1');await shot('connection');
  await click('setup-eda');await pause();assert.ok(await js("!document.getElementById('setup-return').hidden && document.getElementById('setup').hidden"));
  state.edaLogin='signed-in';state.bridge.connected=true;send();await pause();await click('setup-return');await pause();
  assert.ok(await js("document.getElementById('setup-login-status').textContent.includes('已登录') && document.getElementById('setup-next').textContent==='完成设置'"));
  assert.ok(await js("document.getElementById('setup').scrollWidth<=document.getElementById('setup').clientWidth && document.querySelector('.connection-status').getBoundingClientRect().right<=innerWidth"));
  await click('setup-next');await pause();assert.equal(state.setupCompleted,true);assert.equal(state.page,'shop');
  await win.reload();await pause();assert.ok(await js("document.getElementById('setup').hidden"));
  state.page='settings';send();await pause();await click('setup-open');await pause();assert.equal(state.page,'setup');assert.ok(await js("!document.querySelector('[data-setup-panel="+'"0"'+"]').hidden"));
  await click('setup-later');await pause();assert.equal(state.page,'shop');
  console.log('SETUP_UI_OK missing tool, detection, per-EDA drafts, failed save, connection return, restart, reopen, postpone');app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
