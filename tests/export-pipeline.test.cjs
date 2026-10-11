const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const JSZip=require('jszip');
const {createJob,runJob,cleanupJob}=require('../src/export-pipeline.cjs');
async function fixture(t,ids=['C123','C456']) {
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'hub-library-test-'));
  const settings={freecadPython:process.execPath,kicadCli:process.execPath,kicadDir:output};
  const job=await createJob('kicad',ids,settings);
  t.after(async()=>{await cleanupJob(job);await fs.rm(output,{recursive:true,force:true});});
  const archive=new JSZip();archive.file('batch_manifest.json',JSON.stringify({schema:'lcsc-cadence-batch/v1',requestedIds:ids}));
  const zip=path.join(job.root,'batch.zip');await fs.writeFile(zip,await archive.generateAsync({type:'nodebuffer'}));
  return {job,zip,settings,output};
}
test('single pipeline freezes target and settings, counts only converted items, cleans temporary inputs while retaining output',async t=>{
  const {job,zip,settings,output}=await fixture(t);settings.kicadDir='changed';
  const stages=[];
  const result=await runJob(job,zip,stage=>stages.push(stage),{
    processZip:async(file,store)=>{assert.equal(file,zip);assert.equal(store.state.resourceDir,path.join(job.root,'resources'));await fs.mkdir(store.state.resourceDir);return [{id:'C123'}];},
    convert:async(resources,config)=>{assert.equal(config.kicadDir,output);await fs.writeFile(path.join(output,'Library.kicad_sym'),'library');return {results:[{id:'C123',status:'converted'}]};}
  });
  assert.deepEqual(result.successIds,['C123']);assert.equal(result.converted,1);assert.equal(result.failed,1);assert.ok(stages[0].includes('提取'));assert.ok(stages[1].includes('KiCad'));
  await cleanupJob(job);await assert.rejects(fs.access(job.root));await fs.access(path.join(output,'Library.kicad_sym'));
});
test('stale ZIP is rejected before extraction or conversion',async t=>{
  const {job,zip}=await fixture(t);job.ids=['C789'];
  await assert.rejects(runJob(job,zip,()=>{}, {processZip:()=>assert.fail('must not extract')}),/不一致/);
});
test('conversion failure leaves existing output intact and temporary data can be removed',async t=>{
  const {job,zip,output}=await fixture(t);await fs.writeFile(path.join(output,'old.olb'),'unchanged');
  await assert.rejects(runJob(job,zip,()=>{}, {processZip:async()=>[{id:'C123'}],convert:async()=>{throw new Error('native failure');}}),/native failure/);
  await cleanupJob(job);assert.equal(await fs.readFile(path.join(output,'old.olb'),'utf8'),'unchanged');await assert.rejects(fs.access(zip));
});
test('filtered download batch combines reused items with newly converted items',async t=>{
  const {job,zip}=await fixture(t,['C123']);job.ids=['C123','C456'];job.downloadIds=['C123'];job.reused=[{id:'C456',status:'converted',reused:true}];
  const result=await runJob(job,zip,()=>{},{processZip:async()=>[{id:'C123'}],convert:async()=>({results:[{id:'C123',status:'converted'}]})});
  assert.deepEqual(result.successIds,['C456','C123']);assert.equal(result.converted,2);assert.equal(result.failed,0);
});
test('cleanup refuses a library or unrelated directory',async t=>{
  const {output}=await fixture(t);await assert.rejects(cleanupJob({root:output}),/校验失败/);await fs.access(output);
});
test('invalid target and missing native converter fail before starting a job',async t=>{
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'hub-invalid-tool-'));t.after(()=>fs.rm(output,{recursive:true,force:true}));
  await assert.rejects(createJob('unknown',['C123'],{}),/请选择/);
  await assert.rejects(createJob('kicad',['C123'],{freecadPython:process.execPath,kicadDir:output}),/安装路径/);
});

test('whole pipeline forwards structured progress and cooperative stop to both phases',async t=>{
 const {job,zip}=await fixture(t);const events=[];
 const result=await runJob(job,zip,(stage,message,p)=>{if(p)events.push({stage,...p});},{
  processZip:async(_file,_store,_log,control)=>{assert.equal(control.stopFile,path.join(job.root,'stop-requested'));control.onProgress({completed:1,total:2,currentId:'C123'});return [{id:'C123'},{id:'C456'}];},
  convert:async(_items,_settings,_log,control)=>{control.onProgress({completed:1,total:2,currentId:'C123'});job.stopRequested=true;assert.equal(control.isStopped(),true);return {results:[{id:'C123',status:'converted'}]};}
 });assert.equal(events.length,3);assert.equal(result.converted,1);assert.equal(result.failed,1);
});
