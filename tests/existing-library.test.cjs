const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {existingLibrary}=require('../src/existing-library.cjs');
const {createJob,cleanupJob}=require('../src/export-pipeline.cjs');
test('KiCad detects individual symbols and footprints, filters complete parts without native tools',async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-existing-'));
  try {
    await fs.mkdir(path.join(d,'LCSC.pretty'));await fs.mkdir(path.join(d,'LCSC.3dshapes'));
    await fs.writeFile(path.join(d,'LCSC.kicad_sym'),'(kicad_symbol_lib (generator eda_component_hub) (symbol "Cap" (property "LCSC" "C1") (property "Footprint" "LCSC:0603")))');
    await fs.writeFile(path.join(d,'LCSC.pretty','0603.kicad_mod'),'(footprint "0603")');await fs.writeFile(path.join(d,'LCSC.3dshapes','C1.step'),'model');
    const settings={kicadDir:d};let prior=await existingLibrary('kicad',['C1','C2'],settings);
    assert.equal(prior.get('C1').complete,true);assert.equal(prior.has('C2'),false);
    const job=await createJob('kicad',['C1'],settings);assert.deepEqual(job.downloadIds,[]);assert.equal(job.reused[0].id,'C1');await cleanupJob(job);
    await fs.unlink(path.join(d,'LCSC.pretty','0603.kicad_mod'));prior=await existingLibrary('kicad',['C1'],settings);assert.equal(prior.get('C1').symbolExists,true);assert.equal(prior.get('C1').complete,false);
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
test('Cadence existing detection uses the shared footprint model and retries placeholders',async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-existing-model-'));
  try{
    await fs.writeFile(path.join(d,'hub_cadence.json'),JSON.stringify({schema:'eda-component-hub/cadence-v1',library:'Parts',entries:[{id:'C1',entry:'A',footprintEntry:'Pkg',modelName:'A.step',files:[]},{id:'C2',entry:'B',footprintEntry:'Pkg',modelName:'B.step',files:[]}]}));
    for(const f of ['Parts.olb','Pkg.dra','Pkg.psm','A.step','apply_step_models.il'])await fs.writeFile(path.join(d,f),'existing');
    const result=await existingLibrary('cadence',['C1','C2'],{cadenceDir:d,cadenceLibraryName:'Parts'});
    assert.ok(result.get('C1').complete);assert.ok(result.get('C2').complete);assert.equal(result.get('C2').modelFile,path.join(d,'A.step'));
    const file=path.join(d,'hub_cadence.json'),state=JSON.parse(await fs.readFile(file));state.entries[0].modelSource={kind:'height_placeholder',placeholder:true};await fs.writeFile(file,JSON.stringify(state));
    const placeholders=await existingLibrary('cadence',['C1','C2'],{cadenceDir:d,cadenceLibraryName:'Parts'});assert.ok(!placeholders.get('C1').complete);assert.ok(!placeholders.get('C2').complete);
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
test('Cadence requires indexed component files and respects configured OLB name',async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-existing-'));
  try {
    await fs.writeFile(path.join(d,'hub_cadence.json'),JSON.stringify({schema:'eda-component-hub/cadence-v1',library:'Parts',entries:[{id:'C1',entry:'Chip',footprintEntry:'Pkg',files:['Pkg.dra','Pkg.psm','Pkg.step','pin.pad']}]}));
    for(const f of ['Parts.olb','Pkg.dra','Pkg.psm','Pkg.step','pin.pad'])await fs.writeFile(path.join(d,f),'existing');
    const settings={cadenceDir:d,cadenceLibraryName:'Parts'};
    assert.equal((await existingLibrary('cadence',['C1'],settings)).get('C1').complete,true);
    await fs.unlink(path.join(d,'pin.pad'));const partial=(await existingLibrary('cadence',['C1'],settings)).get('C1');assert.equal(partial.symbolExists,true);assert.equal(partial.footprintExists,false);
    assert.equal((await existingLibrary('cadence',['C1'],{...settings,cadenceLibraryName:'Other'})).get('C1').symbolExists,false);
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
