const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const JSZip = require('jszip');
const {processZip} = require('./resources.cjs');
const {convertLibrary} = require('./kicad.cjs');
const {convertCadenceLibrary} = require('./cadence.cjs');
const {convertAltiumLibrary,runPython}=require('./altium.cjs');
const {existingLibrary}=require('./existing-library.cjs');
const PREFIX = 'eda-hub-export-';
async function createJob(target, ids, settings) {
  if (!['kicad','cadence','altium'].includes(target)) throw new Error('请选择 KiCad、Cadence 或 Altium Designer。');
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id=>!/^C[1-9]\d*$/.test(id))) throw new Error('导出清单无效。');
  const output = settings[target+'Dir'];
  if (!output || !path.isAbsolute(output)) throw new Error('请设置目标库的导出目录。');
  await fs.mkdir(output,{recursive:true});
  const probe=path.join(output,'.hub-write-'+require('node:crypto').randomUUID());
  try {await fs.writeFile(probe,'',{flag:'wx'});}catch {throw new Error('目标库目录无法写入。');}finally {await fs.unlink(probe).catch(()=>{});}
  const prior=await existingLibrary(target,ids,settings);
  const downloadIds=ids.filter(id=>!prior.get(id)?.complete);
  const reused=ids.filter(id=>prior.get(id)?.complete).map(id=>({id,status:'converted',reused:true,reusedSymbol:true,reusedFootprint:true,entry:prior.get(id).entry,footprintEntry:prior.get(id).footprintEntry,footprintSource:prior.get(id).record?.footprintSource || prior.get(id).report?.footprintSource,warnings:['目标目录已有完整元件库，跳过下载和转换。']}));
  if(downloadIds.length){
  await fs.access(settings.freecadPython);
  const tools = target === 'altium' ? [] : target === 'kicad' ? [settings.kicadCli] : ['tclsh.exe','orDb_Dll_Tcl64.dll','allegro.exe'].map(file=>path.join(settings.cadenceRoot || '', 'tools/bin', file));
  for (const file of tools) { if (!file || !path.isAbsolute(file)) throw new Error('请先在设置中填写目标 EDA 的安装路径。'); await fs.access(file); }
  if(target==='altium')await runPython(settings,['probe']);
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(),PREFIX));
  return {root,target,ids:[...ids],downloadIds,reused,settings:{...settings},output};
}
async function cleanupJob(job) {
  const root = path.resolve(job.root);
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith(PREFIX)) throw new Error('临时目录校验失败，未执行清理。');
  await fs.rm(root,{recursive:true,force:true});
}
async function runJob(job, zip, progress, deps={}) {
  if(job.downloadIds?.some(id=>!job.ids.includes(id)))throw new Error('下载任务与当前导出清单不一致。');
  const archive = await JSZip.loadAsync(await fs.readFile(zip));
  const manifestFile = archive.file('batch_manifest.json');
  if (!manifestFile) throw new Error('下载包缺少批次信息。');
  const manifest = JSON.parse(await manifestFile.async('string'));
  if (manifest.schema !== 'lcsc-cadence-batch/v1' || !Array.isArray(manifest.requestedIds) || [...manifest.requestedIds].sort().join(',') !== [...(job.downloadIds || job.ids)].sort().join(',')) throw new Error('下载包与当前导出清单不一致。');
  const local = {root:job.root,state:{...job.settings,resourceDir:path.join(job.root,'resources'),resources:[]},persist:async()=>{}};
  const control={isStopped:()=>!!job.stopRequested,stopFile:path.join(job.root,'stop-requested'),onProgress:p=>progress('提取独立模型',undefined,p)};
  progress('提取独立模型',undefined,{completed:0,total:job.downloadIds.length});
  const resources = await (deps.processZip || processZip)(zip,local,message=>progress('提取独立模型',message),control);
  if (resources.some(item=>!job.ids.includes(item.id))) throw new Error('模型提取结果与导出清单不一致。');
  progress('转换 '+({kicad:'KiCad',cadence:'Cadence',altium:'Altium Designer'}[job.target])+' 库');
  const convert = deps.convert || ({kicad:convertLibrary,cadence:convertCadenceLibrary,altium:convertAltiumLibrary}[job.target]);
  const result = !resources.length?{results:[]}:await convert(resources,job.settings,message=>progress('转换元件库',message),{...control,onProgress:p=>progress('转换元件库',undefined,p)});
  for(const item of result.results){const warnings=resources.find(r=>r.id===item.id)?.warnings;if(warnings?.length)item.warnings=[...(item.warnings || []),...warnings];}
  const known=new Set(result.results.map(r=>r.id));
  const extraction=new Map();try{for(const run of await fs.readdir(path.join(job.root,'resources'))){const entries=JSON.parse(await fs.readFile(path.join(job.root,'resources',run,'processing_summary.json'),'utf8').catch(()=>'[]'));for(const entry of entries)extraction.set(entry.partId,entry);}}catch{}
  for(const id of job.downloadIds || job.ids)if(!known.has(id)){const entry=extraction.get(id),runtime=job.message?.results?.find(r=>r.partId===id);result.results.push({id,status:job.stopRequested || entry?.status==='not_started'?'not_started':'failed',message:entry?.message || runtime?.message || (job.stopRequested?'任务已中止，尚未转换。':entry?.status==='skipped_no_step'?'下载包未包含可提取的 STEP；请检查模型绑定和导出设置。':'未获得完整元件资源，请查看提取日志。')});}
  result.results=[...(job.reused || []),...result.results];
  const successIds = [...new Set(result.results.filter(item=>item.status==='converted').map(item=>item.id))];
  if (successIds.some(id=>!job.ids.includes(id))) throw new Error('库转换结果与导出清单不一致。');
  return {...result,successIds,converted:successIds.length,failed:job.ids.length-successIds.length};
}
module.exports={createJob,cleanupJob,runJob};
