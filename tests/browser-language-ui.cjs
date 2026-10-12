const {app,BrowserWindow,WebContentsView,session,ipcMain}=require('electron');
const assert=require('node:assert/strict'),http=require('node:http');
const {setBrowserLanguage}=require('../src/browser-language.cjs');
app.whenReady().then(async()=>{
 const server=http.createServer((request,response)=>{response.setHeader('Content-Type','text/html');response.end(`<script>window.received=${JSON.stringify(request.headers['accept-language'])};window.bootLanguage=navigator.language;window.languageEvents=0;addEventListener('languagechange',()=>window.languageEvents++);</script>`);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let selected='en';
 const ses=session.fromPartition('language-test');setBrowserLanguage(ses,selected);
 ipcMain.on('browser:language',event=>{event.returnValue=selected;});
 ses.registerPreloadScript({type:'frame',filePath:require('node:path').join(__dirname,'../src/browser-language-preload.cjs')});
 const win=new BrowserWindow({show:false}),views=[0,1].map(()=>new WebContentsView({webPreferences:{session:ses,sandbox:true,contextIsolation:true}}));
 for(const view of views)win.contentView.addChildView(view);
 for(const language of ['en','zh-CN','en']){
  selected=language;setBrowserLanguage(ses,language);
  for(const view of views){
   await view.webContents.loadURL(`http://127.0.0.1:${server.address().port}/${language}`);
   const result=await view.webContents.executeJavaScript('({language:navigator.language,languages:navigator.languages,header:window.received,bootLanguage:window.bootLanguage})');
   assert.deepEqual(result.languages,language==='en'?['en-US','en']:['zh-CN','zh']);
   assert.ok(result.header.startsWith(language==='en'?'en-US':'zh-CN'));
   assert.equal(result.language,language==='en'?'en-US':'zh-CN');
   assert.equal(result.bootLanguage,result.language);
  }
 }
 selected='zh-CN';setBrowserLanguage(ses,selected);
 for(const view of views){
  const originalURL=view.webContents.getURL();
  view.webContents.send('browser:language',selected);
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(await view.webContents.executeJavaScript('navigator.language'),'zh-CN');
  assert.equal(view.webContents.getURL(),originalURL);
  assert.equal(await view.webContents.executeJavaScript('window.languageEvents'),1);
 }
 const response=await ses.fetch(`http://127.0.0.1:${server.address().port}/fetch`);assert.match(await response.text(),/zh-CN/);
 server.close();win.destroy();console.log('BROWSER_LANGUAGE_OK');app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
