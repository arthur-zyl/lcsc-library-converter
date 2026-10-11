const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(app.getPath('temp'),'hub-settings-ui-'+require('node:crypto').randomUUID()));
app.whenReady().then(async()=>{
  const state={queue:[],resources:[],logs:[],page:'settings',edaLogin:'signed-in',bridge:{connected:true},navigation:{},settings:{freecadPython:'D:\\FreeCAD 1.1\\bin\\python.exe',resourceDir:'E:\\EDA-Library',downloadDir:'E:\\EDA-Downloads',kicadCli:'D:\\KiCad\\9.0\\bin\\kicad-cli.exe',kicadDir:'E:\\KiCad-Library',kicadFootprintLibraryName:'MyParts',cadenceRoot:'D:/Cadence/SPB_25.1',cadenceDir:'E:/Cadence-Library',cadenceLibraryName:'CadenceParts',altiumDir:'E:/AD-Library',altiumLibraryName:'ADParts',altiumFootprintSource:'easyeda',altiumFootprintDir:''}};
  let repairs=0,detectionFails=false;
  const win=new BrowserWindow({show:false,width:1440,height:960,backgroundColor:'#edf2f5',webPreferences:{offscreen:true,preload:path.join(root,'src/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  let painted;
  win.webContents.on('paint',(_event,_dirty,image)=>{const png=image.toPNG();if(png.length)painted=png;});
  ipcMain.handle('hub:action',(_event,action,value)=>{if(action==='settings-detect')return detectionFails?{ok:false,message:'未检测到安装'}:{ok:true,path:'E:/Detected/'+value,message:'已检测到'};if(action==='settings-save')state.settings={...state.settings,...(value.values || value)};if(action==='cadence-repair-symbols'){repairs++;return {ok:true,message:'已更新'};}return action==='state' ? state : {ok:true,path:null};});
  await win.loadFile(path.join(root,'ui/index.html')); await new Promise(r=>setTimeout(r,200));
  assert.ok(await win.webContents.executeJavaScript('!document.getElementById("settings").hidden && document.querySelectorAll(".settings-field").length>=11 && document.querySelector(".toolbar").hidden'));
  assert.ok(await win.webContents.executeJavaScript("!document.querySelector('[data-settings-group=advanced]') && !document.getElementById('power-rules') && document.getElementById('power-repair').closest('[data-settings-panel]').dataset.settingsPanel==='cadence' && document.querySelector('[data-page=eda]').textContent==='立创 EDA'"));
  const screenshots=process.argv.find(x=>x.startsWith('--screenshots='));
  for(const group of ['general','kicad','altium','cadence']){
    await win.webContents.executeJavaScript(`document.getElementById('settings-tab-${group}').click()`);
    const layout=await win.webContents.executeJavaScript(`(()=>{
      const panel=document.getElementById('settings-panel-${group}');
      const controls=[...panel.querySelectorAll('input,select,.path-field button')];
      return {heights:controls.map(x=>x.getBoundingClientRect().height),
        labels:[...panel.querySelectorAll('label')].map(x=>getComputedStyle(x).display),
        heading:panel.querySelector('h2').getBoundingClientRect().top,
        overflow:document.getElementById('settings').scrollWidth>document.getElementById('settings').clientWidth};
    })()`);
    assert.ok(layout.heights.every(x=>x===40),group+' control heights '+layout.heights);
    assert.ok(layout.labels.every(x=>x==='block'),group+' label layout');
    assert.equal(layout.overflow,false,group+' horizontal overflow');
    if(screenshots){await new Promise(r=>setTimeout(r,80));await fs.writeFile(path.join(screenshots.slice(14),group+'.png'),(await win.webContents.capturePage()).toPNG());}
  }
  await win.webContents.executeJavaScript("document.getElementById('settings-tab-general').click()");
  const preview=process.argv.find(x=>x.startsWith('--preview='));if(preview){const capture=await win.webContents.capturePage();await fs.writeFile(preview.slice(10),capture.toPNG());}
  await win.webContents.executeJavaScript('const input=document.getElementById("setting-freecadPython");input.value="E:\\\\Draft";input.dispatchEvent(new Event("input"));');
  win.webContents.send('hub:state',state);await new Promise(r=>setTimeout(r,50));
  assert.ok(await win.webContents.executeJavaScript('document.getElementById("setting-freecadPython").value.endsWith("Draft") && document.getElementById("settings-hint").textContent.includes("未保存")'));
  await win.webContents.executeJavaScript('document.querySelector("[data-setting-pick=freecadPython]").click()');await new Promise(r=>setTimeout(r,50));
  assert.ok(await win.webContents.executeJavaScript('document.getElementById("setting-freecadPython").value.endsWith("Draft")'));
  await win.webContents.executeJavaScript('document.getElementById("settings-tab-kicad").click()');
  assert.ok(await win.webContents.executeJavaScript('document.getElementById("settings-panel-general").hidden && !document.getElementById("settings-panel-kicad").hidden && document.getElementById("settings-tab-kicad").getAttribute("aria-selected")==="true"'));
  await win.webContents.executeJavaScript('document.getElementById("settings-tab-altium").click()');
  assert.ok(await win.webContents.executeJavaScript('!document.getElementById("settings-panel-altium").hidden && document.getElementById("setting-altiumLibraryName").value === "ADParts"'));
  await win.webContents.executeJavaScript('document.getElementById("settings-tab-cadence").click()');
  assert.ok(await win.webContents.executeJavaScript('!document.getElementById("settings-panel-cadence").hidden && document.getElementById("setting-cadenceLibraryName").value === "CadenceParts"'));
  const cadencePreview=process.argv.find(x=>x.startsWith('--cadence-preview='));if(cadencePreview){await new Promise(r=>setTimeout(r,80));await fs.writeFile(cadencePreview.slice(18),(await win.webContents.capturePage()).toPNG());}
  await win.webContents.executeJavaScript('document.getElementById("settings-tab-general").click()');
  assert.ok(await win.webContents.executeJavaScript('document.getElementById("setting-freecadPython").value.endsWith("Draft")'));
  await win.webContents.executeJavaScript('document.getElementById("settings-tab-kicad").click()');
  assert.ok(await win.webContents.executeJavaScript('document.getElementById("setting-kicadFootprintLibraryName").value === "MyParts"'));
  await win.webContents.executeJavaScript('document.getElementById("setting-kicadFootprintLibraryName").value="HubFootprints";document.getElementById("setting-kicadFootprintLibraryName").dispatchEvent(new Event("input"));document.getElementById("settings-form").requestSubmit()');
  await new Promise(r=>setTimeout(r,100));assert.equal(state.settings.kicadFootprintLibraryName,'HubFootprints');
  await win.webContents.executeJavaScript('document.getElementById("setting-kicadFootprintSource").value="eda";document.getElementById("setting-kicadFootprintSource").dispatchEvent(new Event("input"));document.getElementById("settings-tab-cadence").click()');
  assert.ok(await win.webContents.executeJavaScript('document.getElementById("setting-cadenceFootprintSource").value === "easyeda"'));
  await win.webContents.executeJavaScript('document.getElementById("settings-form").requestSubmit()');await new Promise(r=>setTimeout(r,100));
  assert.equal(state.settings.kicadFootprintSource,'easyeda');
  await win.webContents.executeJavaScript('document.getElementById("settings-tab-kicad").click();document.getElementById("settings-form").requestSubmit()');await new Promise(r=>setTimeout(r,80));assert.equal(state.settings.kicadFootprintSource,'eda');assert.equal(state.settings.cadenceFootprintSource,'easyeda');
  await win.webContents.executeJavaScript('document.getElementById("settings-tab-cadence").click();document.getElementById("power-repair").click()');await new Promise(r=>setTimeout(r,100));assert.equal(repairs,1);
  const advancedPreview=process.argv.find(x=>x.startsWith('--advanced-preview='));if(advancedPreview)await fs.writeFile(advancedPreview.slice(19),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.getElementById('settings-tab-kicad').click();document.querySelector('[data-setting-detect=kicadCli]').click()");await new Promise(r=>setTimeout(r,80));
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('setting-kicadCli').value"),'E:/Detected/kicadCli');
  detectionFails=true;await win.webContents.executeJavaScript("document.querySelector('[data-setting-detect=kicadCli]').click()");await new Promise(r=>setTimeout(r,80));
  assert.equal(await win.webContents.executeJavaScript("document.getElementById('setting-kicadCli').value"),'E:/Detected/kicadCli');
  assert.ok(await win.webContents.executeJavaScript("document.getElementById('settings-hint').textContent.includes('未保存')"));
  win.setSize(1060,720);await new Promise(r=>setTimeout(r,100));
  assert.ok(await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth && document.querySelector("#settings-panel-kicad .path-field").getBoundingClientRect().right<=innerWidth && document.querySelector(".connection-status").getBoundingClientRect().right<=innerWidth'));
  for(const group of ['general','kicad','altium','cadence']){
    await win.webContents.executeJavaScript(`document.getElementById('settings-tab-${group}').click()`);
    assert.ok(await win.webContents.executeJavaScript(`(()=>{const panel=document.getElementById('settings-panel-${group}');return [...panel.querySelectorAll('input,select,textarea,button')].every(x=>x.getBoundingClientRect().right<=document.getElementById('settings-form').getBoundingClientRect().right) && document.getElementById('settings').scrollWidth<=document.getElementById('settings').clientWidth})()`),group+' compact controls');
  }
  if(screenshots)await fs.writeFile(path.join(screenshots.slice(14),'cadence-compact.png'),(await win.webContents.capturePage()).toPNG());
  if(screenshots){
    await win.webContents.executeJavaScript("document.getElementById('settings').scrollTop=document.getElementById('settings').scrollHeight");
    await new Promise(r=>setTimeout(r,80));
    await fs.writeFile(path.join(screenshots.slice(14),'cadence-compact-bottom.png'),(await win.webContents.capturePage()).toPNG());
  }
  state.processing=true;win.webContents.send('hub:state',state);await new Promise(r=>setTimeout(r,50));
  assert.ok(await win.webContents.executeJavaScript('document.getElementById("settings-save").disabled && [...document.querySelectorAll("#settings-form input, #settings-form select, #settings-form textarea, #settings-form button")].every(x=>x.disabled)'));
  console.log('SETTINGS_UI_OK separate page, drafts preserved, picker cancellation, compact width, processing lock');app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
