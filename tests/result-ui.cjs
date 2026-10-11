const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path'); const fs = require('node:fs/promises'); const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(app.getPath('temp'), 'hub-result-ui-' + require('node:crypto').randomUUID()));
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false,width:1000,height:720,backgroundColor:'#edf2f5',webPreferences:{offscreen:true,preload:path.join(root,'src/result-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const choices = [];
  let painted;
  win.webContents.on('paint', (_event, _dirty, image) => { const png = image.toPNG(); if (png.length) painted = png; });
  ipcMain.on('result:choose', (event, value) => { assert.equal(event.sender, win.webContents); choices.push(value); });
  await win.loadFile(path.join(root,'ui/export-result.html'));
  const display = async value => { win.webContents.send('result:state', value); await new Promise(r=>setTimeout(r,100)); };
  await display({id:'first',title:'导出完成',detail:'完整 3，部分 1，失败 0，未开始 0\n下载文件由软件自动接收，FreeCAD 将继续提取模型。可在本地资源查看处理进度。',failed:false});
  const ui = await win.webContents.executeJavaScript('({open:document.querySelector("dialog").open,focused:document.activeElement.id,width:document.querySelector("dialog").getBoundingClientRect().width,primary:getComputedStyle(document.getElementById("result-confirm")).backgroundColor})');
  assert.equal(ui.open,true); assert.equal(ui.focused,'result-confirm'); assert.equal(ui.width,440); assert.notEqual(ui.primary,'rgb(255, 255, 255)');
  const output = process.argv.find(x=>x.startsWith('--preview='));
  if (output) {
    win.webContents.invalidate();
    for (let i=0; i<20 && !painted; i++) await new Promise(r=>setTimeout(r,50));
    assert.ok(painted, 'Offscreen result preview did not paint');
    await fs.writeFile(output.slice('--preview='.length), painted);
  }
  await win.webContents.executeJavaScript('document.getElementById("result-stay").click()'); await new Promise(r=>setTimeout(r,50));
  assert.deepEqual(choices.pop(),{id:'first',choice:'stay'});
  await display({id:'error',title:'导出失败',detail:'<img src=x onerror=alert(1)>\n'+ '很长的错误信息。'.repeat(500),failed:true});
  const errorUI = await win.webContents.executeJavaScript('({hidden:document.getElementById("result-stay").hidden,button:document.getElementById("result-confirm").textContent,images:document.querySelectorAll("img").length,scroll:document.querySelector("p").scrollHeight > document.querySelector("p").clientHeight,bottom:document.querySelector("dialog").getBoundingClientRect().bottom,height:innerHeight})');
  assert.equal(errorUI.hidden,true); assert.equal(errorUI.button,'确定'); assert.equal(errorUI.images,0); assert.equal(errorUI.scroll,true); assert.ok(errorUI.bottom<=errorUI.height);
  await win.webContents.executeJavaScript('document.getElementById("result-confirm").click()'); await new Promise(r=>setTimeout(r,50));
  assert.deepEqual(choices.pop(),{id:'error',choice:'confirm'});
  console.log('RESULT_UI_OK shared styles, focus, stay/confirm, safe text, long error scrolling'); app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
