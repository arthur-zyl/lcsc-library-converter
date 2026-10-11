const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {modelInfo}=require('../src/model-info.cjs'),{existingLibrary}=require('../src/existing-library.cjs');
const {convertCadenceLibrary}=require('../src/cadence.cjs'),{convertLibrary}=require('../src/kicad.cjs');
const fixture=id=>path.join(__dirname,'fixtures/kicad',id);
test('Model provenance distinguishes explicit height placeholders and old warning markers',()=>{
  assert.equal(modelInfo({modelSource:{kind:'height_placeholder'}}).placeholder,true);
  assert.equal(modelInfo({warnings:['未绑定独立 3D 模型，已启用 EDA 根据器件高度自动生成模型。']}).placeholder,true);
  assert.equal(modelInfo({modelSource:{kind:'real'},warnings:['未绑定独立 3D 模型，已启用 EDA 根据器件高度自动生成模型。']}).placeholder,false);
});
async function clonePart(id,d,placeholder,model='C5137636'){
  const JSZip=require('jszip'),folder=path.join(d,id);await fs.cp(fixture('C5137636'),folder,{recursive:true});
  const mf=path.join(folder,'manifest.json'),m=JSON.parse(await fs.readFile(mf));m.partId=id;m.device.name='Test'+id;m.modelSource={kind:placeholder?'height_placeholder':'real',placeholder};
  await fs.writeFile(mf,JSON.stringify(m));
  const file=path.join(folder,'device.elibz'),zip=await JSZip.loadAsync(await fs.readFile(file)),j=JSON.parse(await zip.file('device.json').async('string'));
  for(const dev of Object.values(j.devices)){dev.attributes['Supplier Part']=id;dev.attributes['Manufacturer Part']='Test'+id;}
  zip.file('device.json',JSON.stringify(j));await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
  await fs.copyFile(path.join(fixture(model),model+'_mount_z0.step'),path.join(folder,id+'_mount_z0.step'));
  await fs.unlink(path.join(folder,'pcb_with_component.step'));return {id,folder};
}
for(const sameBatch of [false,true])test('Cadence shared model upgrades placeholder without downgrade '+(sameBatch?'in same batch':'across batches'),{skip:!process.env.HUB_CADENCE_ROOT || !process.env.HUB_FREECAD_PYTHON,timeout:120000},async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-placeholder-cadence-'));
  try{
    const a=await clonePart('C123',d,true),b=await clonePart('C124',d,false,'C96093'),c=await clonePart('C125',d,true);
    const settings={cadenceRoot:process.env.HUB_CADENCE_ROOT,cadenceDir:path.join(d,'library'),cadenceLibraryName:'Models',freecadPython:process.env.HUB_FREECAD_PYTHON};
    let savedDra;
    if(!sameBatch){
      const first=await convertCadenceLibrary([a],settings);assert.equal(first.converted,1,JSON.stringify(first));
      const prior=(await existingLibrary('cadence',[a.id],settings)).get(a.id);assert.equal(prior.complete,false);assert.ok(prior.modelPlaceholder);
      savedDra=await fs.readFile(path.join(settings.cadenceDir,prior.footprintEntry+'.dra'));
    }
    let result=await convertCadenceLibrary(sameBatch?[a,b,c]:[b,c],settings);assert.equal(result.converted,sameBatch?3:2,JSON.stringify(result));
    assert.equal(result.results[sameBatch?1:0].modelReplaced,true);
    let state=JSON.parse(await fs.readFile(path.join(settings.cadenceDir,'hub_cadence.json'),'utf8')),record=state.entries[0];
    assert.equal(new Set(state.entries.map(r=>r.footprintEntry)).size,1);assert.equal(new Set(state.entries.map(r=>r.modelName)).size,1);assert.ok(state.entries.every(r=>!r.modelSource.placeholder));
    assert.equal(record.modelName,record.footprintEntry+'.step');
    assert.deepEqual(await fs.readFile(path.join(settings.cadenceDir,record.modelName)),await fs.readFile(path.join(b.folder,b.id+'_mount_z0.step')));
    if(savedDra)assert.deepEqual(await fs.readFile(path.join(settings.cadenceDir,record.footprintEntry+'.dra')),savedDra);
    assert.ok(!(await fs.readdir(settings.cadenceDir)).includes('apply_step_models.il'));assert.ok(state.entries.every(r=>!r.xml.includes('PKGDEF_STEP_FILE')));
    for(const r of state.entries)r.modelSource={kind:'height_placeholder',placeholder:true};await fs.writeFile(path.join(settings.cadenceDir,'hub_cadence.json'),JSON.stringify(state));
    const olb=await fs.readFile(path.join(settings.cadenceDir,'Models.olb')),psm=await fs.readFile(path.join(settings.cadenceDir,record.footprintEntry+'.psm'));
    result=await convertCadenceLibrary([b],settings);assert.equal(result.converted,1,JSON.stringify(result));assert.ok(result.results[0].modelReplaced);
    assert.deepEqual(await fs.readFile(path.join(settings.cadenceDir,'Models.olb')),olb);assert.deepEqual(await fs.readFile(path.join(settings.cadenceDir,record.footprintEntry+'.psm')),psm);
    assert.equal(JSON.parse(await fs.readFile(path.join(settings.cadenceDir,record.modelName+'.json'),'utf8')).placeholder,false);
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
test('KiCad upgrades placeholder STEP and embedded model, preserving symbols and pads',{skip:!process.env.HUB_KICAD_CLI,timeout:90000},async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-placeholder-kicad-'));
  try{
    const resource=await clonePart('C123',d,true),settings={kicadDir:path.join(d,'library'),kicadCli:process.env.HUB_KICAD_CLI,kicadFootprintLibraryName:'Parts'};
    let result=await convertLibrary([resource],settings);assert.equal(result.converted,1,JSON.stringify(result));
    const record=result.results[0],sym=await fs.readFile(path.join(settings.kicadDir,'LCSC.kicad_sym'));
    assert.equal(record.model.placeholder,true);assert.equal((await existingLibrary('kicad',[resource.id],settings)).get(resource.id).complete,false);
    const fpFile=path.join(settings.kicadDir,'Parts.pretty',record.footprintEntry+'.kicad_mod'),sx=require('../src/sexpr.cjs');
    const oldFp=sx.parse(await fs.readFile(fpFile,'utf8'));
    const mf=path.join(resource.folder,'manifest.json'),m=JSON.parse(await fs.readFile(mf));m.modelSource={kind:'real',placeholder:false};await fs.writeFile(mf,JSON.stringify(m));
    const bytes=await fs.readFile(path.join(fixture('C96093'),'C96093_mount_z0.step'));await fs.writeFile(path.join(resource.folder,'C123_mount_z0.step'),bytes);
    result=await convertLibrary([resource],settings);assert.equal(result.converted,1,JSON.stringify(result));assert.ok(result.results[0].modelReplaced);assert.ok(!result.results[0].model.placeholder);
    assert.deepEqual(await fs.readFile(path.join(settings.kicadDir,'LCSC.kicad_sym')),sym);
    const nextFp=sx.parse(await fs.readFile(fpFile,'utf8'));assert.deepEqual(sx.children(nextFp,'pad'),sx.children(oldFp,'pad'));
    assert.notDeepEqual(sx.child(nextFp,'embedded_files'),sx.child(oldFp,'embedded_files'));
    assert.deepEqual(await fs.readFile(path.join(settings.kicadDir,'LCSC.3dshapes','C123.step')),bytes);
    assert.equal((await existingLibrary('kicad',[resource.id],settings)).get(resource.id).complete,true);
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
