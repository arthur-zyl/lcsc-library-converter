const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {readComponent}=require('../src/easyeda-library.cjs'),{geometry}=require('../src/altium-geometry.cjs');
const {convertAltiumLibrary,runPython}=require('../src/altium.cjs'),{existingLibrary}=require('../src/existing-library.cjs');
const fixture=id=>path.join(__dirname,'fixtures/kicad',id),native={skip:!process.env.HUB_FREECAD_PYTHON,timeout:120000};
test('AD geometry preserves physical pads, pin directions and multi-unit ownership',async()=>{
  const part=await readComponent(fixture('C658109')),g=geometry(part,'IC','Pkg');assert.equal(g.pins.length,20);assert.equal(g.pads.length,20);
  assert.ok(g.pins.every(p=>[0,90,180,270].includes(p.angle)));assert.equal(g.pins.find(p=>p.number==='15').y,-1.27);
  assert.ok(g.units[0].graphics.length);part.footprintRows.find(r=>r[0]==='PAD')[10][0]='UNKNOWN';assert.throws(()=>geometry(part,'IC','Pkg'),/焊盘形状/);
});
test('AD native cumulative binary libraries retain Chinese, SMD/THT and exact embedded STEP',native,async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-ad-native-'));
  try{
    const settings={freecadPython:process.env.HUB_FREECAD_PYTHON,altiumDir:path.join(d,'lib'),altiumLibraryName:'Parts'};
    const resources=['C5137636','C96093','C658109'].map(id=>({id,folder:fixture(id)}));
    const result=await convertAltiumLibrary(resources,settings);assert.equal(result.converted,3,JSON.stringify(result));
    for(const ext of ['SchLib','PcbLib'])assert.equal((await fs.readFile(path.join(settings.altiumDir,'Parts.'+ext))).subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1');
    const previous=await existingLibrary('altium',resources.map(r=>r.id),settings);assert.ok([...previous.values()].every(p=>p.complete));
    const sch=await fs.readFile(path.join(settings.altiumDir,'Parts.SchLib')),pcb=await fs.readFile(path.join(settings.altiumDir,'Parts.PcbLib'));
    const again=await convertAltiumLibrary(resources,settings);assert.ok(again.results.every(r=>r.reused));assert.deepEqual(await fs.readFile(path.join(settings.altiumDir,'Parts.SchLib')),sch);assert.deepEqual(await fs.readFile(path.join(settings.altiumDir,'Parts.PcbLib')),pcb);
    const localSettings={...settings,altiumDir:path.join(d,'reuse'),altiumFootprintSource:'eda',altiumFootprintDir:settings.altiumDir};
    const reused=await convertAltiumLibrary([resources[0]],localSettings);assert.equal(reused.converted,1,JSON.stringify(reused));assert.equal(reused.results[0].footprintSource,'eda');
    for(const ext of ['SchLib','PcbLib']){
      await fs.unlink(path.join(settings.altiumDir,'Parts.'+ext));
      const repair=await convertAltiumLibrary([resources[0]],settings);assert.equal(repair.converted,1,JSON.stringify(repair));
      const all=await existingLibrary('altium',resources.map(r=>r.id),settings);assert.ok([...all.values()].every(r=>r.complete));
    }
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
test('AD native multi-part symbol hot spots, footprint binding and model survive binary readback',native,async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-ad-multi-'));
  try{
    const part=await readComponent(fixture('C658109')),g=geometry(part,'Multi','Pkg');g.unitCount=2;g.units.push({...g.units[0],unit:2});
    for(const p of g.pins)if(Number(p.number)>10)p.unit=2;
    const input={entry:'Multi',footprintEntry:'Pkg',library:'MultiLib',name:part.name,geometry:g,model:part.model,modelName:'Pkg.step',updateModel:true,output:d,audit:path.join(d,'audit.json')};
    const file=path.join(d,'input.json');await fs.writeFile(file,JSON.stringify(input));await runPython({freecadPython:process.env.HUB_FREECAD_PYTHON},['convert',file]);
    const report=JSON.parse(await fs.readFile(input.audit));assert.equal(report.units,2);assert.equal(report.pins,20);assert.equal(report.pads,20);
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
async function clone(id,d,placeholder,model){
  const folder=path.join(d,id),JSZip=require('jszip');await fs.cp(fixture('C5137636'),folder,{recursive:true});
  const mf=path.join(folder,'manifest.json'),m=JSON.parse(await fs.readFile(mf));m.partId=id;m.device.name='Test'+id;m.modelSource={kind:placeholder?'height_placeholder':'real',placeholder};await fs.writeFile(mf,JSON.stringify(m));
  const dev=path.join(folder,'device.elibz'),z=await JSZip.loadAsync(await fs.readFile(dev)),j=JSON.parse(await z.file('device.json').async('string'));
  for(const item of Object.values(j.devices)){item.attributes['Supplier Part']=id;item.attributes['Manufacturer Part']='Test'+id;}z.file('device.json',JSON.stringify(j));await fs.writeFile(dev,await z.generateAsync({type:'nodebuffer'}));
  await fs.copyFile(path.join(fixture(model),model+'_mount_z0.step'),path.join(folder,id+'_mount_z0.step'));await fs.unlink(path.join(folder,'pcb_with_component.step'));return {id,folder};
}
test('AD shared placeholder upgrades embedded model without rewriting symbols or downgrading real model',native,async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-ad-model-'));
  try{
    const a=await clone('C123',d,true,'C96093'),b=await clone('C124',d,false,'C5137636'),c=await clone('C125',d,true,'C96093');
    const settings={freecadPython:process.env.HUB_FREECAD_PYTHON,altiumDir:path.join(d,'lib'),altiumLibraryName:'Models'};
    let result=await convertAltiumLibrary([a],settings);assert.equal(result.converted,1,JSON.stringify(result));
    const before=(await existingLibrary('altium',[a.id],settings)).get(a.id);assert.equal(before.complete,false);
    const symbol=await fs.readFile(path.join(settings.altiumDir,'Models.SchLib'));
    // Upgrade the same component to verify existing symbol bytes remain untouched.
    const mf=path.join(a.folder,'manifest.json'),m=JSON.parse(await fs.readFile(mf));m.modelSource={kind:'real',placeholder:false};await fs.writeFile(mf,JSON.stringify(m));await fs.copyFile(path.join(b.folder,b.id+'_mount_z0.step'),path.join(a.folder,a.id+'_mount_z0.step'));
    result=await convertAltiumLibrary([a],settings);assert.equal(result.converted,1,JSON.stringify(result));assert.equal(result.results[0].modelReplaced,true);assert.deepEqual(await fs.readFile(path.join(settings.altiumDir,'Models.SchLib')),symbol);
    result=await convertAltiumLibrary([b,c],settings);assert.equal(result.converted,2,JSON.stringify(result));
    const index=JSON.parse(await fs.readFile(path.join(settings.altiumDir,'hub_altium.json')));assert.equal(new Set(index.entries.map(r=>r.footprintEntry)).size,1);assert.ok(index.entries.every(r=>!r.modelSource.placeholder));
    assert.deepEqual(await fs.readFile(path.join(settings.altiumDir,index.entries[0].modelName)),await fs.readFile(path.join(b.folder,b.id+'_mount_z0.step')));
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
