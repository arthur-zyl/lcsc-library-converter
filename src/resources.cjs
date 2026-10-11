const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { paths } = require('./settings.cjs');
const { modelInfo } = require('./model-info.cjs');
async function processZip(zip, store, log, control={}) {
  await fs.access(store.state.freecadPython);
  const output = paths(store).resourceDir; await fs.mkdir(output, { recursive: true });
  const priorRuns = new Set(await fs.readdir(output));
  const script = path.join(__dirname, '../tools/process_download.py');
  let failure;
  try {await new Promise((resolve, reject) => {
    const child = spawn(store.state.freecadPython, [script, zip, '--out-dir', output,...(control.stopFile?['--stop-file',control.stopFile]:[])], { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } });
    let pending='';child.stdout.on('data',x=>{pending+=x.toString('utf8');let at;while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at).trim();pending=pending.slice(at+1);if(line.startsWith('HUB_PROGRESS ')){try{control.onProgress?.(JSON.parse(line.slice(13)));}catch{}}else if(line)log(line);}}); child.stderr.on('data', x => log(x.toString('utf8')));
    const timer=setTimeout(()=>{child.kill();reject(new Error('FreeCAD 处理超时，请重试或查看日志。'));},30*60*1000);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(pending)log(pending);code===0?resolve():reject(new Error('FreeCAD 处理失败；请查看诊断报告。'));});
  });
  }catch(error){failure=error;}
  for(const run of await fs.readdir(output)) {
    if(priorRuns.has(run) || !run.startsWith('run_'))continue;
    const summary=JSON.parse(await fs.readFile(path.join(output,run,'processing_summary.json'),'utf8').catch(()=>'[]'));
    for(const entry of summary.filter(item=>item.status!=='extracted')) {
      log(`${entry.partId} 模型提取未完成：${entry.message || entry.status}`);
      if(/^C[1-9]\d*$/.test(entry.partId)){const detail=await fs.readFile(path.join(output,run,entry.partId,'processing.log'),'utf8').catch(()=>'');if(detail)log(detail.slice(-3500));}
    }
  }
  if(failure)throw failure;
  const indexed = await indexResources(store);
  return indexed.filter(item => !priorRuns.has(path.basename(path.dirname(item.folder))));
}
async function indexResources(store) {
  const root = paths(store).resourceDir; await fs.mkdir(root, { recursive: true });
  const resources = [];
  for (const run of await fs.readdir(root, { withFileTypes: true })) {
    if (!run.isDirectory() || !run.name.startsWith('run_')) continue;
    const runDir = path.join(root, run.name);
    let summary; try { summary = JSON.parse(await fs.readFile(path.join(runDir, 'processing_summary.json'), 'utf8')); } catch { continue; }
    for (const entry of summary) {
      if (entry.status !== 'extracted' || !/^C[1-9]\d*$/.test(entry.partId)) continue;
      const folder = path.join(runDir, entry.partId);
      const manifest = JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8'));
      const report = JSON.parse(await fs.readFile(path.join(folder, entry.partId + '_report.json'), 'utf8'));
      const step = entry.partId + '_mount_z0.step'; await fs.access(path.join(folder, step));
      let existing;try{existing=JSON.parse(await fs.readFile(path.join(folder,'component.json'),'utf8'));}catch{}
      const conversions=existing?.id===entry.partId ? existing.conversions : undefined;
      const resource = { schema: 'eda-component-resource/v0.1', id: entry.partId, provider: 'easyeda-pro',
        name: manifest.device?.name || entry.partId, units: 'mm', createdAt: manifest.createdAt,
        artifacts: { sourceManifest: 'manifest.json', model: step, modelValidation: entry.partId + '_report.json',
          originalDevice: 'device.elibz', originalFootprint: 'footprint.elibz' },
        model: { ...modelInfo(manifest),mountPlaneZ: 0, sourceRotationPreserved: true, extractionTranslationMm: report.mount_translation_mm },
        footprint: { status: 'source_only', normalizedGeometry: null }, symbol: { status: 'source_only' },
        conversions: { cadence: 'not_converted', altium: 'not_converted', kicad: 'not_converted', ...conversions } };
      await fs.writeFile(path.join(folder, 'component.json'), JSON.stringify(resource, null, 2));
      resources.push({ id: resource.id, name: resource.name, folder, model: path.join(folder, step), createdAt: resource.createdAt, conversions:resource.conversions });
    }
  }
  store.state.resources = resources; await store.persist(); return resources;
}
module.exports = { processZip, indexResources };
