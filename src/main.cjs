const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('node:path'); const fs = require('node:fs/promises'); const { randomUUID } = require('node:crypto');
const { Store, isShop } = require('./store.cjs'); const { Bridge, DISCOVERY_PORT } = require('./bridge.cjs');
const { attachDiscovery } = require('./discovery-session.cjs');
const {navigationController}=require('./browser-navigation.cjs');
const navigationControllers=new WeakMap();let navigationConfirmation;
const {createJob,cleanupJob,runJob}=require('./export-pipeline.cjs');
const {preserveArtifacts,hasFailure}=require('./failed-artifacts.cjs');
const {ExportLog}=require('./export-log.cjs');
const {preflight}=require('./preflight.cjs');
const {initialize,nextBatch,acceptBatch,summary,batchProgress}=require('./export-batches.cjs');
const {recover,checkpoint}=require('./recovery.cjs');
const {itemResults,exportSelection}=require('./export-results.cjs');
let exportJournal;
const { parseDetails } = require('./product-details.cjs');
const { paths, saveSettings } = require('./settings.cjs');
const {DOWNLOADS,detectFreeCAD,checkTools}=require('./setup.cjs');
const { detectKiCad } = require('./kicad.cjs');
const {detectCadence}=require('./cadence.cjs');
const ROOT = path.resolve(__dirname, '..');
let win, store, bridge, shop, eda, current = 'shop', logs = [], processing = false;
let edaCover, resultCover, edaLocked = false, resultDialogOpen = false, exportResult;
let exportJob, startingExport=false;
let exportProgress, settingsBusy = false, converting = false, conversionProgress = '';
function showExportResult(message) {
  if (!win || win.isDestroyed() || resultDialogOpen) return;
  resultDialogOpen = true;
  setEdaLocked(false);
  exportResult={id:randomUUID(),failed:!message.converted,title:message.stoppedReason?'任务已中止':message.converted?'导出完成':'导出失败',
    detail:`${({kicad:'KiCad',cadence:'Cadence',altium:'Altium Designer'}[message.target])}：成功 ${message.converted}，未完成 ${message.failed}。\n${message.converted?'目标元件库已保存到设置的固定目录。\n':''}${message.message || ''}${message.failed?'\n未完成的元件保留在清单中，可重新导出。':''}`,
    confirmLabel:message.converted?'打开库目录':'确定',stayLabel:'关闭',logPath:message.logPath,openFolder:message.converted?message.folder:undefined};
  current='queue';layout();resultCover.webContents.send('result:state',exportResult);resultCover.webContents.focus();publish();
}
async function openLibraryFolder(folder) {
  if(!folder || !path.isAbsolute(folder))throw new Error('请在设置中填写完整的库导出目录。');
  await fs.mkdir(folder,{recursive:true});
  const error=await shell.openPath(folder);if(error)throw new Error('无法打开库目录：'+error);
}
async function openExportLog(file) {
  if(!file)throw new Error('暂无导出日志，请先运行一次导出。');
  await fs.access(file);const error=await shell.openPath(file);if(error)throw new Error('无法打开日志：'+error);
}
async function saveExportLog(error,result,runtime) {
  const journal=exportJournal;if(!journal)return;
  journal.finish(error,result,runtime);
  try {
    const file=await journal.save(store.root);
    store.state.lastExportLogs={...store.state.lastExportLogs,[journal.target]:file};
    await store.persist();return file;
  }catch(e){log('导出日志保存失败：'+e.message);}
  finally {exportJournal=undefined;}
}
function dismissExportResult(id, choice) {
  if(resultDialogOpen && exportResult?.id===id && choice==='log'){void openExportLog(exportResult.logPath).catch(e=>log(e.message));return;}
  if (!resultDialogOpen || exportResult?.id !== id || !['confirm','stay'].includes(choice)) return;
  if(exportResult.openFolder && choice==='confirm') void openLibraryFolder(exportResult.openFolder).catch(error=>log(error.message));
  else if (!exportResult.failed && choice === 'confirm') current = 'queue';
  resultDialogOpen = false; exportResult = undefined;
  layout(); publish();
  if (current === 'eda') eda.webContents.focus(); else win.webContents.focus();
}
function setEdaLocked(value) { if (edaLocked === value) return; edaLocked = value; if (!win || win.isDestroyed()) return; layout(); if (value && edaCover && !edaCover.webContents.isDestroyed()) edaCover.webContents.focus(); else if (!value && current === 'eda' && eda && !eda.webContents.isDestroyed()) eda.webContents.focus(); publish(); }
let edaLogin = 'checking', loginPrompted = false;
const PLUGIN_NAME = 'lcsc-cadence-downloader_v0.5.6.eext';
function setLogin(value) { if (edaLogin === value) return; edaLogin = value; if (value === 'signed-out' && !loginPrompted) { loginPrompted = true; current = 'eda'; layout(); log('请先登录立创 EDA，登录后才能连接和导出。'); } publish(); }
const metadataSmoke = process.argv.includes('--metadata-smoke');
const journeySmoke = process.argv.includes('--journey-smoke');
const batchSmoke=process.argv.includes('--batch-smoke');
const kicadSmoke = process.argv.includes('--kicad-smoke');
const cadenceSmoke = process.argv.includes('--cadence-smoke');
const altiumSmoke=process.argv.includes('--altium-smoke');
const setupSmoke=process.argv.includes('--setup-smoke');
const smoke = process.argv.includes('--smoke') || metadataSmoke || journeySmoke || kicadSmoke || cadenceSmoke || altiumSmoke || setupSmoke || batchSmoke;
// Keep hidden startup checks separate from an already running user's browser session.
if (smoke) app.setPath('userData', path.join(app.getPath('temp'), 'eda-component-hub-smoke-' + randomUUID()));
function log(message) { exportJournal?.add(message); logs.push({ time: new Date().toLocaleTimeString('zh-CN'), message: String(message).slice(0, 4000) }); logs = logs.slice(-100); publish(); }
function snapshot() { const view = current === 'eda' ? eda : current === 'shop' ? shop : undefined;
  return { ...store.state, settings:paths(store),settingsBusy,converting,conversionProgress, metadata: Object.fromEntries(metadata), bridge: bridge.status(), logs, processing, page: current, root: ROOT, edaLogin, edaLocked,
    navigationConfirmation:navigationConfirmation?{id:navigationConfirmation.id,provider:navigationConfirmation.provider,action:navigationConfirmation.action}:null,
    navigation: { url: view?.webContents.getURL() || '', available: !!view,
      back: view?.webContents.navigationHistory.canGoBack() || false, forward: view?.webContents.navigationHistory.canGoForward() || false } }; }
function publish() { if (win && !win.isDestroyed() && store && bridge) {
  layout();
  win.webContents.send('hub:state', snapshot());
  if (exportProgress && edaCover && !edaCover.webContents.isDestroyed()) edaCover.webContents.send('export:progress', {...exportProgress, requestId:exportJob?.requestId, stopRequested:!!exportJob?.stopRequested, canStop:!!exportJob && !exportJob.finishing});
  if (shop && !shop.webContents.isDestroyed()) shop.webContents.send('shop:queue', store.state.queue.map(x => x.id));
} }
function layout() { if (!win || win.isDestroyed()) return; const [w, h] = win.getContentSize();
  const top=(!['setup'].includes(current)&&(edaLogin==='signed-out'||!bridge?.status().connected&&edaLogin!=='checking'))?158:120;
  for (const [name, view] of [['shop', shop], ['eda', eda]]) { if (!view) continue; view.setVisible(name === current&&!navigationConfirmation); view.setBounds({ x: 16, y: top, width: Math.max(w - 32, 1), height: Math.max(h - top-16, 1) }); }
  if (edaCover) { edaCover.setBounds({ x:16, y:120, width:Math.max(w-32,1), height:Math.max(h-136,1) }); edaCover.setVisible(edaLocked && current === 'eda'); }
  if (resultCover) { resultCover.setBounds({x:0,y:0,width:w,height:h}); resultCover.setVisible(resultDialogOpen); }
}
function navigate(view, url, provider) { const u = new URL(url); if (u.protocol !== 'https:' || (provider === 'shop' ? !isShop(u) : !(u.hostname === 'lceda.cn' || u.hostname.endsWith('.lceda.cn')))) throw new Error('此页签仅允许打开相应服务的 HTTPS 页面'); navigationControllers.get(view).perform('navigate',u.href); }
function browser(preload, provider) {
  const view = new WebContentsView({ webPreferences: { partition: 'persist:component-hub-web', preload,
    nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false } });
  win.contentView.addChildView(view);
  navigationControllers.set(view,navigationController(view.webContents,{error:log,blocked:request=>{
    navigationConfirmation={...request,provider,view};layout();publish();win.webContents.focus();
  }}));
  view.webContents.setWindowOpenHandler(({ url }) => { try { navigate(view, url, provider); } catch { log('外部链接已阻止；可复制链接到系统浏览器打开'); } return { action: 'deny' }; });
  view.webContents.on('will-navigate', (event, url) => { try { const u = new URL(url); const allowed = u.protocol === 'https:' && (isShop(u) || u.hostname === 'lceda.cn' || u.hostname.endsWith('.lceda.cn'));
    if (!allowed) { event.preventDefault(); log('已阻止外部导航'); } } catch { event.preventDefault(); } });
  view.webContents.on('did-fail-load', (_event, code, desc) => { if (code !== -3) log(provider + '：' + desc); });
  view.webContents.on('did-navigate', publish); view.webContents.on('did-navigate-in-page', publish); view.webContents.on('did-finish-load', publish);
  return view;
}
async function finishJob(job, error, result) {
  if(exportJob!==job || job.finishing)return;
  job.finishing=true;clearTimeout(job.timer);
  if(!result)result=summary(job);
  if(job.runtimeResults?.length)job.message={...job.message,results:[...new Map([...job.runtimeResults,...(job.message?.results || [])].map(r=>[r.partId,r])).values()]};
  if(error)log(error.message);
  store.state.exportItemResults={...store.state.exportItemResults,[job.target]:{...store.state.exportItemResults?.[job.target],...itemResults(job,result,error)}};await store.persist().catch(e=>log('逐项结果保存失败：'+e.message));
  await fs.writeFile(path.join(job.output,'last_export_report.json'),JSON.stringify({target:job.target,requestedIds:job.ids,successIds:result?.successIds || [],error:error?.message,stoppedReason:job.stopRequested?(job.stopReason || '用户中止'):job.message?.stoppedReason,logs:logs.slice(-30)},null,2)).catch(e=>log('诊断报告保存失败：'+e.message));
  store.state.lastExportSummary={target:job.target,finishedAt:new Date().toISOString(),items:job.ids.map(id=>({id,name:store.state.queue.find(x=>x.id===id)?.name || id,...store.state.exportItemResults[job.target][id]}))};await store.persist().catch(e=>log('结果摘要保存失败：'+e.message));
  if(result?.successIds.length)await store.removeMany(result.successIds).catch(e=>log('清单更新失败：'+e.message));
  exportProgress={...exportProgress,stage:'清理临时文件',percent:100,completed:result?.converted || 0};publish();
  let cleanupMessage='';
  try {
    if(hasFailure(job,result,error)){
      const diagnosticPath=await preserveArtifacts(job.root,path.join(store.root,'failed-exports'),{target:job.target,requestedIds:job.ids,error:error?.message,results:result?.results,logs:[...logs]});
      cleanupMessage=diagnosticPath?'失败任务文件已保留：'+diagnosticPath:'';
      await fs.writeFile(path.join(job.output,'last_failure_files.json'),JSON.stringify({diagnosticPath},null,2));
      if(cleanupMessage)log(cleanupMessage);
    }else await cleanupJob(job);
  }catch(e){cleanupMessage='文件归档或清理失败：'+e.message+'；临时文件保留位置：'+job.root;log(cleanupMessage);}
  const logPath=await saveExportLog(error,result,job.message);
  delete store.state.activeExport;await store.persist().catch(e=>log('恢复记录更新失败：'+e.message));
  exportJob=undefined;processing=false;converting=false;conversionProgress='';
  showExportResult({type:'pipeline-result',logPath,target:job.target,converted:result?.converted || 0,failed:job.ids.length-(result?.converted || 0),folder:job.output,stoppedReason:job.stopRequested?(job.stopReason || '用户中止'):job.message?.stoppedReason,message:[result?.results?.some(r=>r.reused)?`已存在并复用 ${result.results.filter(r=>r.reused).length} 个元件。`:null,job.settings[job.target+'FootprintSource']==='eda' && result?.converted?`封装来源：EDA 本地库 ${result.results.filter(r=>r.status==='converted' && r.footprintSource==='eda').length} 个，立创 ${result.results.filter(r=>r.status==='converted' && r.footprintSource!=='eda').length} 个。`:null,error?.message,cleanupMessage,job.message?.pcbCleanup?.status==='debug_pcbs_retained'?'调试 PCB 已保留在立创 EDA 的 lcsc-cadence-downloader 工程，名称包含 C 编号；具体保存结果见导出日志。':null,job.message?.pcbCleanup?.status==='delete_failed'?'临时 PCB 删除失败：'+job.message.pcbCleanup.message:''].filter(Boolean).join('\n')});
}
async function processJobIfReady(job) {
  if(exportJob!==job || job.running || job.finishing || !job.message || !job.file)return;
  job.running=true;clearTimeout(job.timer);
  if(job.message.fileName!==job.fileName)return finishJob(job,new Error('下载文件与本次任务不一致。'));
  try {
    const batchJob=Object.assign(Object.create(job),{ids:job.batchIds || job.ids,downloadIds:job.batchIds || job.downloadIds,reused:[]});
    const result=await runJob(batchJob,job.file,(stage,message,p)=>{
      converting=stage.startsWith('转换');conversionProgress=message || stage;
      const percent=batchProgress(job,converting?'convert':'extract',p?.completed || 0,p?.total || job.batchIds?.length);job.percent=Math.max(job.percent || 0,percent);
      exportProgress={total:job.ids.length,completed:job.processedCount+(p?.completed || 0),phaseCompleted:p?.completed ?? exportProgress?.phaseCompleted ?? 0,phaseTotal:p?.total ?? exportProgress?.phaseTotal ?? job.batchIds.length,currentId:p?.currentId || exportProgress?.currentId || '',percent:job.percent,stage:`第 ${job.batchIndex+1}/${job.batches.length} 批 · `+(message?stage+'：'+String(message).slice(0,180):stage)};
      if(message || !p)log(message || stage);else publish();
    });
    acceptBatch(job,result);
    store.state.exportItemResults={...store.state.exportItemResults,[job.target]:{...store.state.exportItemResults?.[job.target],...itemResults(batchJob,result)}};await store.persist();
    if(job.message?.stoppedReason || job.message?.pcbCleanup?.status==='delete_failed'){job.stopRequested=true;job.stopReason=job.message.stoppedReason || '临时 PCB 清理失败，停止后续批次。';}
    if(nextBatch(job)){job.requestId=bridge.send(job.batchIds,{retainExportPcb:job.settings.retainExportPcb}).requestId;converting=false;exportProgress={total:job.ids.length,completed:job.processedCount,currentId:'',percent:batchProgress(job,'download'),stage:`第 ${job.batchIndex+1}/${job.batches.length} 批 · 准备导出`};publish();return;}
    await finishJob(job,null,summary(job));
  }catch(e){await finishJob(job,e);}
}
const enrichment = new Map();
const metadata = new Map();
function enrichItem(item, retry = false) {
  if (!item.url || enrichment.has(item.id)) return;
  if (!retry && item.parameters?.length && item.package) { metadata.set(item.id, { status: 'ready' }); return; }
  const url = new URL(item.url);
  if (url.hostname !== 'item.szlcsc.com' || !/^\/\d+\.html$/.test(url.pathname)) return;
  url.search = ''; url.hash = '';
  metadata.set(item.id, { status: 'loading' }); publish();
  const request = (async () => {
    try {
      const response = await shop.webContents.session.fetch(url.href, { signal: AbortSignal.timeout(20000), cache: 'no-cache' });
      // Electron's session.fetch can return a successful Response with an empty url.
      // The request is restricted above; parseDetails additionally requires the exact requested C number.
      if (!response.ok || response.url && new URL(response.url).hostname !== 'item.szlcsc.com') throw new Error('商品详情读取失败');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('商品详情过大'); chunks.push(Buffer.from(chunk)); }
      const details = parseDetails(Buffer.concat(chunks).toString('utf8'), item.id, url.href);
      if (win && !win.isDestroyed() && store.state.queue.some(x => x.id === item.id)) { await store.add(details); metadata.set(item.id, { status: 'ready' }); log(`${item.id} 商品信息已补全：${details.package || '无封装'}，${details.parameters.length} 项参数`); }
    } catch (error) { metadata.set(item.id, { status: 'error', message: error.message }); log(`${item.id} 商品信息补全失败：${error.message}`); }
  })().finally(() => enrichment.delete(item.id));
  enrichment.set(item.id, request);
}
app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) { if (smoke) throw new Error('Smoke instance could not acquire its isolated lock'); app.quit(); return; }
  store = await new Store(smoke ? path.join(app.getPath('userData'), 'data') : path.join(ROOT, 'data')).init(); bridge = await new Bridge().start();await recover(store);
  if(!store.state.freecadPython)store.state.freecadPython=await detectFreeCAD();
  if((!smoke || setupSmoke) && !store.state.setupCompleted && !store.state.setupShown)current='setup';
  if(!store.state.kicadCli)store.state.kicadCli=await detectKiCad();
  if(!store.state.cadenceRoot)store.state.cadenceRoot=await detectCadence();
  bridge.on('state', () => { if (!bridge.active && edaLocked && !exportJob) setEdaLocked(false); if (bridge.status().connected && bridge.loggedIn === true) setLogin('signed-in'); else if (bridge.status().connected && bridge.loggedIn === null && edaLogin === 'signed-out') setLogin('unknown'); publish(); }); bridge.on('message', m => {
    if (m.type === 'progress' && m.progress && bridge.active) {
      const total = bridge.active.ids.length, p = m.progress;
      exportJournal?.add(`立创 EDA 阶段：${p.stage || ''}；器件 ${p.currentId || ''}；${p.completed}/${total}`);
      if (Number.isInteger(p.completed) && p.completed >= 0 && p.completed <= total && typeof p.stage === 'string') exportProgress = {total:exportJob?.ids.length || total, completed:p.completed+(exportJob?.reused.length || 0)+(exportJob?.processedCount || 0),phaseCompleted:p.completed,phaseTotal:total,currentId:bridge.active.ids.includes(p.currentId) ? p.currentId : '',stage:p.stage.slice(0,120),percent:exportJob?batchProgress(exportJob,'download',p.completed,total):35*p.completed/Math.max(total,1)};
    }
    if (['hello','auth'].includes(m.type) && typeof m.loggedIn === 'boolean') setLogin(m.loggedIn ? 'signed-in' : 'signed-out');
    if (['exported','failed'].includes(m.type) && exportJob?.requestId===m.requestId) {
      const job=exportJob;
      if(m.type==='failed'){job.message=m;job.download?.cancel();void finishJob(job,new Error(m.message || '立创 EDA 导出失败。'));}
      else {job.message=m;job.percent=Math.max(job.percent || 0,batchProgress(job,'download',1,1));exportProgress={...exportProgress,total:job.ids.length,percent:job.percent,stage:'接收下载文件'};void processJobIfReady(job);job.timer=setTimeout(()=>{if(exportJob===job && !job.running){job.download?.cancel();void finishJob(job,new Error('未收到完整下载包，请重试。'));}},120000);}
    }
    log(m.message || (m.type === 'exported' ? '立创 EDA 导出完成，等待下载处理' : JSON.stringify(m)));
  });
  win = new BrowserWindow({ title: 'EDA Component Hub · 元件资源库', width: 1440, height: 960, minWidth: 1060, minHeight: 720,
    show: !smoke, backgroundColor: '#f3f6f5', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  shop = browser(path.join(__dirname, 'shop-preload.cjs'), 'shop'); eda = browser(path.join(__dirname, 'eda-preload.cjs'), 'eda');
  edaCover = new WebContentsView({webPreferences:{preload:path.join(__dirname,'progress-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  edaCover.setBackgroundColor('#00000000'); win.contentView.addChildView(edaCover); edaCover.setVisible(false);
  edaCover.webContents.setWindowOpenHandler(()=>({action:'deny'})); edaCover.webContents.on('will-navigate',event=>event.preventDefault());
  await edaCover.webContents.loadFile(path.join(ROOT,'ui/eda-lock.html'));
  ipcMain.handle('export:stop',(event,requestId)=>{
    if(event.sender!==edaCover.webContents) throw new Error('来源无效');
    if(!edaLocked || !exportJob || exportJob.finishing || requestId!==exportJob.requestId) return {ok:false,message:'任务正在收尾或已经结束。'};
    exportJob.stopRequested=true;void fs.writeFile(path.join(exportJob.root,'stop-requested'),'stop').catch(e=>log(e.message));bridge.stop();log('已请求中止，等待当前元件处理和清理完成；已导出的结果会保留。');
    return {ok:true};
  });
  resultCover = new WebContentsView({webPreferences:{preload:path.join(__dirname,'result-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  resultCover.setBackgroundColor('#00000000'); win.contentView.addChildView(resultCover); resultCover.setVisible(false);
  resultCover.webContents.setWindowOpenHandler(()=>({action:'deny'})); resultCover.webContents.on('will-navigate',event=>event.preventDefault());
  ipcMain.on('result:choose',(event,value)=>{if(event.sender===resultCover.webContents) dismissExportResult(value?.id,value?.choice);});
  await resultCover.webContents.loadFile(path.join(ROOT,'ui/export-result.html'));
  eda.webContents.on('before-input-event',event=>{if(edaLocked || resultDialogOpen)event.preventDefault();});
  win.webContents.on('before-input-event',(event,input)=>{if(edaLocked && (input.key==='F5' || input.key==='BrowserBack' || input.key==='BrowserForward' || (input.control || input.meta) && ['r','l','w'].includes(input.key.toLowerCase())))event.preventDefault();});
  ipcMain.on('eda:login', (event, value) => { if (event.sender !== eda.webContents) return; if (value === 'signed-out') { if (bridge.status().connected && bridge.loggedIn === true) return; setLogin(value); } else if (edaLogin !== 'signed-in') setLogin('checking'); });
  // Discovery credentials are added only to requests from our embedded EDA view.
  attachDiscovery(eda.webContents, bridge);
  if (!smoke) { try { await bridge.startDiscovery(); } catch (error) { log(`自动发现服务启动失败（端口 ${DISCOVERY_PORT}）：${error.message}。可使用手动连接地址。`); } }
  shop.webContents.on('did-finish-load', publish);
  if (!smoke) { navigate(shop, 'https://www.szlcsc.com/', 'shop'); navigate(eda, 'https://pro.lceda.cn/editor', 'eda'); }
  if (!smoke) setTimeout(() => { if (edaLogin === 'checking') setLogin('unknown'); }, 15000);
  win.on('resize', layout); win.on('closed', () => { shop?.webContents.close(); eda?.webContents.close(); edaCover?.webContents.close(); resultCover?.webContents.close(); bridge.close(); });
  eda.webContents.session.on('will-download', (_event, item, sender) => {
    if (sender?.id !== eda.webContents.id || !/^LCSC_batch_[\w.-]+\.zip$/i.test(item.getFilename())) return;
    const job=exportJob;
    if(!job || job.download || job.finishing){item.cancel();return;}
    job.download=item;job.fileName=item.getFilename();
    const file=path.join(job.root,`${job.batchIndex || 0}-${job.fileName}`);item.setSavePath(file);
    item.on('done',(_ev,state)=>{
      if(exportJob!==job || job.finishing)return;
      if(state==='completed'){job.file=file;log('下载已接收，开始处理目标库');void processJobIfReady(job);}
      else void finishJob(job,new Error('下载未完成：'+state));
    });
  });
  ipcMain.on('shop:capture', async (event, payload) => {
    if (event.sender !== shop.webContents || !isShop(new URL(shop.webContents.getURL()))) return;
    try { if (payload.error) throw new Error(payload.error); const item = await store.add(payload); log('已加入：' + item.id); enrichItem(item); } catch (e) { log(e.message); } publish();
  });
  ipcMain.handle('hub:action', async (event, action, value) => {
    if (event.sender !== win.webContents) throw new Error('来源无效');
    try {
      if (edaLocked && !['state','plugin-path'].includes(action)) throw new Error('正在导出，立创 EDA 操作已锁定，请等待完成。');
      if (resultDialogOpen && !['state','plugin-path'].includes(action)) throw new Error('请先确认导出结果。');
      if(navigationConfirmation&&!['state','plugin-path','navigation-confirm'].includes(action))throw new Error('请先确认是否离开当前网页。');
      if(settingsBusy && !['state','plugin-path'].includes(action)) throw new Error('正在保存设置，请稍候。');
      if(converting && ['settings-save','export'].includes(action))throw new Error('正在转换元件库，请等待完成。');
      switch (action) {
        case 'state': return snapshot();
        case 'page': if (!['shop', 'eda', 'queue','settings','setup'].includes(value)) throw new Error('未知页面'); current = value; layout(); if (value === 'queue') for (const item of store.state.queue) if (!item.parameters?.length && !enrichment.has(item.id)) enrichItem(item); break;
        case 'details': { const item = store.state.queue.find(x => x.id === value); if (!item) throw new Error('元件已移出清单'); enrichItem(item, true); break; }
        case 'navigate': navigate(current === 'eda' ? eda : shop, String(value), current === 'eda' ? 'eda' : 'shop'); break;
        case 'back': case 'forward': case 'refresh': { if(!['shop','eda'].includes(current))throw new Error('请先打开网页页签');navigationControllers.get(current==='eda'?eda:shop).perform(action);break; }
        case 'navigation-confirm': { if(!navigationConfirmation||value?.id!==navigationConfirmation.id)throw new Error('导航确认已失效');const request=navigationConfirmation;navigationConfirmation=undefined;navigationControllers.get(request.view).confirm(value.id,value.accepted===true);layout();break; }
        case 'capture': shop.webContents.send('shop:capture-request'); break;
        case 'remove': await store.remove(String(value)); break;
        case 'clear': await store.clearQueue(); log('导出清单已清空'); break;
        case 'product': { const item = store.state.queue.find(x => x.id === value); if (!item?.url) throw new Error('此元件暂无商品链接'); navigate(shop, item.url, 'shop'); current = 'shop'; layout(); break; }
        case 'pair': case 'open-login': { const alreadyOpen=current==='eda';current='eda';layout();if(alreadyOpen||!eda.webContents.getURL())navigate(eda,'https://pro.lceda.cn/editor','eda');eda.webContents.focus();break; }
        case 'pair-manual': clipboard.writeText(bridge.uri); log('连接地址已复制。在立创 EDA 高级菜单选择“手动连接地址”。'); break;
        case 'footprint-source': if(!['easyeda','eda'].includes(value))throw new Error('封装来源无效');store.state[(store.state.exportTarget || 'kicad')+'FootprintSource']=value;await store.persist();break;
        case 'export-target': if(!['kicad','cadence','altium'].includes(value))throw new Error('未知目标 EDA');store.state.exportTarget=value;await store.persist();break;
        case 'export-log': await openExportLog(store.state.lastExportLogs?.[store.state.exportTarget || 'kicad']);break;
        case 'output-folder': await openLibraryFolder(paths(store)[(store.state.exportTarget||'kicad')+'Dir']);break;
        case 'export-check': {
          if(startingExport || exportJob || processing || converting)throw new Error('已有任务运行中。');
          const loggedIn=bridge.status().connected?await bridge.checkLogin():null;
          const {target,ids}=exportSelection(value,store.state);return preflight(target,ids,paths(store),{connected:bridge.status().connected,loggedIn});
        }
        case 'export': {
          if(startingExport || bridge.active || exportJob || processing || converting || settingsBusy)throw new Error('已有任务运行中。');
          const {ids,target}=exportSelection(value,store.state);
          exportJournal=new ExportLog(target,ids,paths(store));
          startingExport=true;processing=true;publish();
          try {
            const job=initialize(await createJob(target,ids,paths(store)));exportJob=job;await checkpoint(store,job);delete store.state.recovery;await store.persist();
            for(const item of job.reused)log(`${item.id}：目标库已存在，跳过下载及转换`);
            if(!job.downloadIds.length){await finishJob(job,null,{converted:job.reused.length,results:job.reused,successIds:job.ids});break;}
            if(edaLogin==='signed-out')throw new Error('请先登录立创 EDA，再开始导出。');
            const authenticated=await bridge.checkLogin();
            if(authenticated!==true){if(authenticated===false)setLogin('signed-out');throw new Error('请登录立创 EDA 并连接插件后导出。');}
            const checked=await preflight(target,ids,job.settings,{connected:bridge.status().connected,loggedIn:authenticated});if(!checked.ok)throw new Error(checked.checks.filter(x=>!x.ok).map(x=>x.label+'：'+x.message).join('\n'));
            exportProgress={total:ids.length,completed:0,currentId:'',stage:'准备导出工程'};
            setLogin('signed-in');current='eda';setEdaLocked(true);
            nextBatch(job);job.requestId=bridge.send(job.batchIds,{retainExportPcb:job.settings.retainExportPcb}).requestId;layout();log('开始一键导出 '+(({kicad:'KiCad',cadence:'Cadence',altium:'Altium Designer'}[target]))+' 库');
          }catch(e){if(exportJob)await finishJob(exportJob,e);else {log(e.message);await saveExportLog(e);processing=false;publish();}throw e;}
          finally {startingExport=false;}
          break;
        }
        case 'settings-detect': {
          const detectors={freecadPython:detectFreeCAD,kicadCli:detectKiCad,cadenceRoot:detectCadence};
          if(!Object.hasOwn(detectors,value))throw new Error('未知工具');
          const detected=await detectors[value]();
          const label={freecadPython:'FreeCAD',kicadCli:'KiCad',cadenceRoot:'Cadence'}[value];
          return detected?{ok:true,path:detected,message:'已检测到 '+label+'，保存设置后生效。'}:{ok:false,message:'未检测到 '+label+' 的完整安装，请先安装或手动选择路径。'};
        }
        case 'settings-pick': {
          if(!['freecadPython','kicadCli','kicadDir','cadenceRoot','cadenceDir','kicadFootprintDir','cadenceFootprintDir','altiumDir','altiumFootprintDir'].includes(value)) throw new Error('未知设置');
          const executable=['freecadPython','kicadCli'].includes(value);
          const selected=await dialog.showOpenDialog(win,{title:{freecadPython:'选择 FreeCAD bin 目录内的 python.exe',kicadCli:'选择 KiCad bin 目录内的 kicad-cli.exe',kicadDir:'选择 KiCad 库导出目录',cadenceRoot:'选择 Cadence SPB 安装目录',cadenceDir:'选择 Cadence 库导出目录',kicadFootprintDir:'选择 KiCad 本地封装库',cadenceFootprintDir:'选择 Cadence 本地封装库',altiumDir:'选择 AD 库导出目录',altiumFootprintDir:'选择 AD 本地 PcbLib 目录'}[value],defaultPath:paths(store)[value],properties:executable ? ['openFile'] : ['openDirectory','createDirectory'],...(executable ? {filters:[{name:'程序',extensions:['exe']}]} : {})});
          return {ok:true,path:selected.canceled ? null : selected.filePaths[0]};
        }
        case 'setup-download': {
          if(!DOWNLOADS[value])throw new Error('未知下载地址');
          await shell.openExternal(DOWNLOADS[value]);return {ok:true};
        }
        case 'setup-detect': return {ok:true,freecadPython:await detectFreeCAD(),kicadCli:await detectKiCad(),cadenceRoot:await detectCadence()};
        case 'setup-check': return {ok:true,...await checkTools(value)};
        case 'setup-save': {
          if(processing || bridge.active || converting)throw new Error('请等待导出完成后再配置工具。');
          settingsBusy=true;publish();
          try{
            await checkTools(value);
            await saveSettings(store,value,{target:value.target});
            store.state.exportTarget=value.target;await store.persist();
          }finally{settingsBusy=false;publish();}
          return {ok:true,message:'工具和库目录已保存。'};
        }
        case 'setup-finish': {
          if(processing || bridge.active || converting)throw new Error('请等待导出完成后再完成配置。');
          await checkTools({...paths(store),target:store.state.exportTarget || 'kicad'});
          store.state.setupCompleted=true;await store.persist();current='shop';layout();break;
        }
        case 'settings-save': {
          if(processing || bridge.active || converting) throw new Error('导出或处理期间不能修改路径，请等待任务完成。');
          settingsBusy=true; publish();
          try {
            await saveSettings(store,value.values || value,{group:value.group});
            log('设置已保存，后续导出使用新目录。');
          } finally { settingsBusy=false; publish(); }
          return {ok:true,message:'设置已保存'};
        }
        case 'cadence-repair-symbols': {
          if(startingExport || bridge.active || exportJob || processing || converting || settingsBusy)throw new Error('已有任务运行中，请等待完成。');
          converting=true;publish();
          try{
            const {convertCadenceLibrary}=require('./cadence.cjs');
            const result=await convertCadenceLibrary([],paths(store),log);
            return {ok:true,message:result.symbolsUpdated?`已恢复源引脚类型并更新重复名称（${result.managedSymbols} 个元件），封装和模型保持原样。`:'已有原理图库无需修改。'};
          }finally{converting=false;publish();}
        }
        case 'installer': await shell.openPath(path.join(ROOT, 'dist')); break;
        case 'plugin-path': { const file = path.join(ROOT, 'dist', PLUGIN_NAME); await fs.access(file); clipboard.writeText(path.dirname(file)); return { ok: true, message: '插件文件夹路径已复制' }; }
        default: throw new Error('未知操作');
      }
      publish(); return { ok: true };
    } catch (e) { if (edaLocked && !bridge.active && !exportJob) setEdaLocked(false); log(e.message); return { ok: false, message: e.message }; }
  });
  await win.loadFile(path.join(ROOT, 'ui/index.html')); layout(); store.state.resources=[]; if(current==='setup'){store.state.setupShown=true;await store.persist();} publish();
  if(setupSmoke){
    await new Promise(r=>setTimeout(r,100));
    if(!store.state.setupShown || current!=='setup' || shop.getVisible() || eda.getVisible() || !await win.webContents.executeJavaScript('!document.getElementById("setup").hidden'))throw new Error('First-run guide failed to hide embedded browser views');
    const action=(name,value)=>win.webContents.executeJavaScript('window.hub.call('+JSON.stringify(name)+','+JSON.stringify(value ?? null)+')');
    const detected=await action('setup-detect');if(!detected.ok || !detected.freecadPython)throw new Error('FreeCAD discovery failed');
    for(const key of ['freecadPython','kicadCli','cadenceRoot']){const result=await action('settings-detect',key);if(detected[key] && (!result.ok || result.path!==detected[key]))throw new Error('Tool path detection mismatch: '+key);}
    const config={target:'altium',freecadPython:detected.freecadPython,altiumDir:path.join(store.root,'test-library'),altiumLibraryName:'FirstRun'};
    const saved=await action('setup-save',config);if(!saved.ok)throw new Error(saved.message);
    if(store.state.setupCompleted)throw new Error('Setup completed before user confirmation');
    const shown=await new Store(store.root).init();if(!shown.state.setupShown || shown.state.setupCompleted)throw new Error('Shown guide was not remembered independently of completion');
    const finished=await action('setup-finish');if(!finished.ok || current!=='shop' || !shop.getVisible())throw new Error('Finish failed: '+JSON.stringify(finished));
    const fresh=await new Store(store.root).init();if(!fresh.state.setupCompleted || fresh.state.exportTarget!=='altium' || fresh.state.altiumLibraryName!=='FirstRun')throw new Error('Setup did not persist');
    console.log('SETUP_SMOKE_OK first launch, hidden browser views, detection, real tool validation, scoped settings save, persisted completion');app.quit();return;
  }
  if(batchSmoke){
    const waitFor=async check=>{const deadline=Date.now()+120000;while(!check()){if(Date.now()>deadline)throw new Error('Batch smoke timed out');await new Promise(r=>setTimeout(r,30));}};
    const JSZip=require('jszip'),{WebSocket}=require('ws');store.state.kicadDir=path.join(store.root,'batch-library');
    const ids=['C5137636',...Array.from({length:49},(_,i)=>'C'+(90000000+i)),'C658109'];for(const id of ids)await store.add({id});
    const secondStep=path.join(store.root,'batch-second.step');await new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(store.state.freecadPython,['-c',`import FreeCAD as A, Part, Import, sys; d=A.newDocument('BatchProbe'); b=d.addObject('PartDesign::Feature','Board'); b.Label='Board~batch'; b.Shape=Part.makeBox(40,40,1.6); m=d.addObject('PartDesign::Feature','Component'); m.Shape=Part.read(sys.argv[1]); m.Placement.Base.z=1.6; Import.export([b,m],sys.argv[2])`,path.join(ROOT,'tests/fixtures/kicad/C658109/C658109_mount_z0.step'),secondStep],{windowsHide:true});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Batch STEP fixture failed')));});
    let zipBytes,fileName,requests=[];await eda.webContents.session.protocol.handle('https',()=>new Response(zipBytes,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="'+fileName+'"'}}));
    const client=new WebSocket(bridge.uri);await new Promise(r=>client.once('open',r));
    client.on('message',async bytes=>{const m=JSON.parse(bytes);if(m.type==='check-auth')client.send(JSON.stringify({type:'auth',probeId:m.probeId,loggedIn:true}));if(m.type!=='export')return;try{
      requests.push(m.ids);const zip=new JSZip();zip.file('batch_manifest.json',JSON.stringify({schema:'lcsc-cadence-batch/v1',requestedIds:m.ids}));
      for(const id of m.ids.filter(id=>['C5137636','C658109'].includes(id)))for(const name of ['manifest.json','device.elibz','footprint.elibz','pcb_with_component.step']){let bytes=await fs.readFile(id==='C658109' && name==='pcb_with_component.step'?secondStep:path.join(ROOT,'tests/fixtures/kicad',id,name));if(id==='C658109' && name==='manifest.json'){const manifest=JSON.parse(bytes);manifest.placement.footprintXMm=0;manifest.placement.footprintYMm=0;bytes=Buffer.from(JSON.stringify(manifest));}zip.file(id+'/'+name,bytes);}
      zipBytes=await zip.generateAsync({type:'nodebuffer'});fileName='LCSC_batch_'+requests.length+'.zip';client.send(JSON.stringify({type:'exported',requestId:m.requestId,fileName,results:m.ids.map(partId=>({partId,status:['C5137636','C658109'].includes(partId)?'complete':'failed',message:'simulated missing component'}))}));setTimeout(()=>eda.webContents.downloadURL('https://pro.lceda.cn/batch.zip'),50);
    }catch(e){console.error(e);app.exit(1);}});
    client.send(JSON.stringify({type:'hello',loggedIn:true}));await waitFor(()=>edaLogin==='signed-in');const started=await win.webContents.executeJavaScript('window.hub.call("export","kicad")');if(!started.ok)throw new Error(started.message);await waitFor(()=>resultDialogOpen);
    if(requests.map(x=>x.length).join(',')!=='50,1' || store.state.queue.length!==49 || store.state.activeExport || !exportResult.detail.includes('成功 2，未完成 49'))throw new Error('Batch integration failed '+JSON.stringify({sizes:requests.map(x=>x.length),queue:store.state.queue.length,result:exportResult}));
    if(store.state.lastExportSummary.items.length!==51 || store.state.exportItemResults.kicad.C658109.status!=='converted' || !store.state.exportItemResults.kicad.C658109.warnings.some(w=>w.includes('no face colors')))throw new Error('Missing batch item results');client.close();console.log('BATCH_SMOKE_OK 50+1 real conversions, failures retained, results aggregated and journal cleared');app.quit();return;
  }
  if (journeySmoke || kicadSmoke || cadenceSmoke || altiumSmoke) {
    dialog.showMessageBox=()=>{throw new Error('Export must use the custom dialog');};
    const {WebSocket}=require('ws'),JSZip=require('jszip');
    const waitFor=async predicate=>{const until=Date.now()+180000;while(!predicate() && Date.now()<until)await new Promise(r=>setTimeout(r,30));if(!predicate())throw new Error('Export journey timeout: '+JSON.stringify(logs.slice(-5)));};
    const target=altiumSmoke?'altium':cadenceSmoke?'cadence':'kicad';
    if(process.argv.includes('--local-footprints'))store.state[target+'FootprintSource']='eda';
    const archive=new JSZip();archive.file('batch_manifest.json',JSON.stringify({schema:'lcsc-cadence-batch/v1',requestedIds:['C5137636','C123']}));
    for(const file of ['manifest.json','device.elibz','footprint.elibz','pcb_with_component.step'])archive.file('C5137636/'+file,await fs.readFile(path.join(ROOT,'tests/fixtures/kicad/C5137636',file)));
    const zip=await archive.generateAsync({type:'nodebuffer'}),fileName='LCSC_batch_smoke.zip';
    await eda.webContents.session.protocol.handle('https',request=>request.url.endsWith('/batch.zip')?new Response(zip,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="'+fileName+'"'}}):new Response('<html><body><button>登录</button></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8'}}));
    await eda.webContents.loadURL('https://pro.lceda.cn/hub-login-test');await waitFor(()=>edaLogin==='signed-out');
    await store.add({id:'C5137636'});await store.add({id:'C123'});publish();
    if((await win.webContents.executeJavaScript('window.hub.call("export")')).ok)throw new Error('Logged-out export accepted');
    if(resultDialogOpen){await resultCover.webContents.executeJavaScript('document.getElementById("result-confirm").click()');await waitFor(()=>!resultDialogOpen);}
    const client=new WebSocket(bridge.uri);await new Promise(r=>client.once('open',r));let task,stopped=false;
    client.on('message',bytes=>{const m=JSON.parse(bytes);if(m.type==='check-auth')client.send(JSON.stringify({type:'auth',probeId:m.probeId,loggedIn:true}));if(m.type==='export')task=m;if(m.type==='stop')stopped=true;});
    client.send(JSON.stringify({type:'hello',loggedIn:true,version:'0.5.4'}));await waitFor(()=>edaLogin==='signed-in');
    await win.webContents.executeJavaScript('window.hub.call("export-target",'+JSON.stringify(target)+')');
    const folder=paths(store)[target+'Dir'],originalOpen=shell.openPath;let opened;
    try {shell.openPath=async value=>{opened=value;return '';};const response=await win.webContents.executeJavaScript('window.hub.call("output-folder")');if(!response.ok || opened!==folder)throw new Error('Initial library folder did not open');await fs.access(folder);}finally {shell.openPath=originalOpen;}
    current='queue';layout();publish();await new Promise(r=>setTimeout(r,100));
    if(!await win.webContents.executeJavaScript('!document.querySelector("[data-page=resources]") && !document.getElementById("resources") && document.getElementById("export-target").value==='+JSON.stringify(target)))throw new Error('Export cart target UI incorrect');
    const started=await win.webContents.executeJavaScript('window.hub.call("export",'+JSON.stringify(target)+')');await waitFor(()=>!!task);
    if(!started.ok || !edaLocked || current!=='eda' || !edaCover.getVisible())throw new Error('Export did not lock EDA');
    const popup=await edaCover.webContents.executeJavaScript('({y:document.querySelector(".lock-message").getBoundingClientRect().top,h:innerHeight,background:getComputedStyle(document.body).backgroundColor})');
    if(popup.y>80 || popup.background!=='rgba(0, 0, 0, 0)')throw new Error('Progress dialog obscures EDA');
    const temp=exportJob.root;
    if((await win.webContents.executeJavaScript('window.hub.call("refresh")')).ok)throw new Error('Export lock escaped');
    client.send(JSON.stringify({type:'progress',requestId:task.requestId,progress:{completed:1,currentId:'C5137636',stage:'导出 STEP 模型'}}));await waitFor(()=>exportProgress.stage==='导出 STEP 模型');
    if(journeySmoke){await new Promise(r=>setTimeout(r,100));await edaCover.webContents.executeJavaScript('document.getElementById("stop-export").click()');await waitFor(()=>stopped);}
    const notify=()=>client.send(JSON.stringify({type:'exported',requestId:task.requestId,fileName,stoppedReason:journeySmoke?'用户请求中止':''}));
    if(cadenceSmoke) {
      eda.webContents.downloadURL('https://pro.lceda.cn/batch.zip');await waitFor(()=>!!exportJob?.file);
      if(resultDialogOpen || !edaLocked)throw new Error('Download prematurely completed export');notify();
    } else {
      notify();await waitFor(()=>!bridge.active);
      if(resultDialogOpen || !edaLocked)throw new Error('EDA notification prematurely completed export');
      eda.webContents.downloadURL('https://pro.lceda.cn/batch.zip');
    }
    await waitFor(()=>resultDialogOpen);
    if(journeySmoke){if(edaLocked || processing || converting || exportJob || store.state.queue.length!==2 || !exportResult.detail.includes('成功 0，未完成 2') || await fs.stat(temp).catch(()=>false))throw new Error('Canceled task must retain unconverted queue and clean temporary inputs');console.log('JOURNEY_SMOKE_OK safe stop in EasyEDA phase, custom result, unchanged queue, cleaned temporary inputs');client.close();app.quit();return;}
    if(edaLocked || processing || converting || exportJob || current!=='queue' || store.state.queue.length!==1 || store.state.queue[0].id!=='C123')throw new Error('Pipeline completion/queue failed');
    if(await fs.stat(temp).catch(()=>false))throw new Error('Temporary job files survived completion');
    if(process.argv.includes('--local-footprints')){const report=JSON.parse(await fs.readFile(path.join(paths(store)[target+'Dir'],'conversion_report.json'),'utf8'));if(report.results[0].footprintSource!=='eda')throw new Error('Local footprint was not used: '+JSON.stringify(report));}
    await fs.access(path.join(paths(store)[target+'Dir'],'LCSC.'+({kicad:'kicad_sym',cadence:'olb',altium:'SchLib'}[target])));
    await new Promise(r=>setTimeout(r,100));
    const rendered=await resultCover.webContents.executeJavaScript('document.body.textContent');
    if(!rendered.includes('成功 1，未完成 1') || !rendered.includes('打开库目录'))throw new Error('Unified completion dialog incorrect');
    const successLog=exportResult.logPath;
    const successBytes=await fs.readFile(successLog,'utf8');
    if(!successBytes.includes('C123：未完成') || !successBytes.includes('任务结束：成功 1'))throw new Error('Partial export log incomplete');
    let openedLog;shell.openPath=async file=>{openedLog=file;return '';};
    await resultCover.webContents.executeJavaScript('document.getElementById("result-log").click()');await waitFor(()=>openedLog===successLog);
    if(!resultDialogOpen)throw new Error('Log action dismissed result dialog');
    await resultCover.webContents.executeJavaScript('document.getElementById("result-stay").click()');await waitFor(()=>!resultDialogOpen);
    task=null;await win.webContents.executeJavaScript('window.hub.call("export",'+JSON.stringify(target)+')');await waitFor(()=>!!task);
    const failedTemp=exportJob.root;
    client.send(JSON.stringify({type:'failed',requestId:task.requestId,message:'Simulated export failure'}));await waitFor(()=>resultDialogOpen);
    if(edaLocked || store.state.queue.length!==1 || await fs.stat(failedTemp).catch(()=>false) || !(await fs.readdir(path.join(store.root,'failed-exports'))).length)throw new Error('Failure archive/queue failed');
    const failureLog=exportResult.logPath;
    if(failureLog===successLog || !(await fs.readFile(failureLog,'utf8')).includes('Simulated export failure'))throw new Error('Failure export log incomplete');
    await resultCover.webContents.executeJavaScript('document.getElementById("result-confirm").click()');await waitFor(()=>!resultDialogOpen);
    await win.webContents.executeJavaScript('window.hub.call("export-log")');
    if(openedLog!==failureLog)throw new Error('Queue did not open latest target log');
    const reloaded=await new Store(store.root).init();if(reloaded.state.lastExportLogs[target]!==failureLog)throw new Error('Log path not persisted');
    await store.clearQueue();await store.add({id:'C5137636'});task=null;
    await win.webContents.executeJavaScript('window.hub.call("export",'+JSON.stringify(target)+')');await waitFor(()=>resultDialogOpen);
    if(task || store.state.queue.length || !exportResult.detail.includes('已存在并复用 1'))throw new Error('Existing component was downloaded again');
    await resultCover.webContents.executeJavaScript('document.getElementById("result-confirm").click()');await waitFor(()=>!resultDialogOpen);
    await store.add({id:'C123'});
    setLogin('signed-out');
    const preflight=await win.webContents.executeJavaScript('window.hub.call("export",'+JSON.stringify(target)+')');
    const preflightLog=store.state.lastExportLogs[target];
    if(preflight.ok || preflightLog===failureLog || !(await fs.readFile(preflightLog,'utf8')).includes('请先登录立创 EDA'))throw new Error('Preflight failure log missing');
    console.log('PIPELINE_SMOKE_OK '+target+' native extraction/conversion, both download ordering paths, lock, partial queue, temporary cleanup, custom dialog, failure retry');
    client.terminate();app.quit();return;
  }
  if (metadataSmoke) {
    // Exercise the production capture IPC, metadata request, persistence and cart renderer together.
    const { net } = require('electron');
    await shop.webContents.session.protocol.handle('https', request => {
      if (request.url === 'https://so.szlcsc.com/hub-metadata-test') return new Response('<html><body><article><a href="https://item.szlcsc.com/3180495.html">FRC0603F1002TS</a><p>商品编号：C2906982</p><button>加入购物车</button></article></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    });
    await shop.webContents.loadURL('https://so.szlcsc.com/hub-metadata-test');
    await shop.webContents.executeJavaScript('document.querySelector("[data-eda-resource-button]").click()');
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline && !store.state.queue[0]?.parameters.length) await new Promise(resolve => setTimeout(resolve, 100));
    const item = store.state.queue[0]; if (!item?.parameters.length) throw new Error('Capture enrichment failed: ' + JSON.stringify(logs));
    current = 'queue'; layout(); publish();
    await new Promise(resolve => setTimeout(resolve, 200));
    const rendered = await win.webContents.executeJavaScript('document.querySelector(".cart-item").textContent');
    if (!rendered.includes('10kΩ') || !rendered.includes('100mW') || !rendered.includes('封装：0603')) throw new Error('Enriched metadata missing from actual cart');
    console.log('METADATA_SMOKE_OK ' + JSON.stringify({ id: item.id, package: item.package, parameters: item.parameters.length })); app.quit(); return;
  }
  if (smoke) {
    const result = await win.webContents.executeJavaScript('({title: document.title, buttons: document.querySelectorAll("button").length, hasBridge: typeof window.hub.call === "function"})');
    if (result.title !== 'EDA Component Hub' || result.buttons < 8 || !result.hasBridge) throw new Error('UI smoke failed');
    console.log('SMOKE_OK ' + JSON.stringify(result)); app.quit();
  }
}).catch(e => { console.error(e); if (!smoke) dialog.showErrorBox('EDA Component Hub', e.message); app.exit(1); });
app.on('window-all-closed', () => app.quit());
