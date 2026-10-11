const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {detectFreeCAD,checkTools}=require('../src/setup.cjs');
const {Store}=require('../src/store.cjs'),{saveSettings,paths}=require('../src/settings.cjs');
const probe='HUB_TOOL={"freecad":"1.1.0","python":[3,11]}';
test('guide is shown once independently of completion, and existing configurations do not reopen it',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-guide-once-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=await new Store(root).init();assert.equal(store.state.setupShown,false);
  store.state.setupShown=true;await store.persist();
  const restarted=await new Store(root).init();assert.equal(restarted.state.setupShown,true);assert.ok(!restarted.state.setupCompleted);
  await fs.writeFile(path.join(root,'state.json'),JSON.stringify({queue:[],freecadPython:'existing.exe'}));
  const legacy=await new Store(root).init();assert.equal(legacy.state.setupShown,true);assert.equal(legacy.state.freecadPython,'existing.exe');
});
test('EDA discovery finds newest supported KiCad and complete Cadence installs across roots',async t=>{
  const {detectKiCad}=require('../src/kicad.cjs'),{detectCadence}=require('../src/cadence.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-eda-detect-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const bases=[path.join(root,'A'),path.join(root,'B')];
  for(const [base,version] of [[bases[0],'8.0'],[bases[0],'9.0'],[bases[1],'10.0']]){await fs.mkdir(path.join(base,version,'bin'),{recursive:true});await fs.writeFile(path.join(base,version,'bin/kicad-cli.exe'),'');}
  assert.equal(await detectKiCad(bases),path.join(bases[1],'10.0/bin/kicad-cli.exe'));
  await fs.unlink(path.join(bases[1],'10.0/bin/kicad-cli.exe'));assert.equal(await detectKiCad(bases),path.join(bases[0],'9.0/bin/kicad-cli.exe'));
  for(const [base,name,files] of [[bases[0],'SPB_24.1',['tclsh.exe','orDb_Dll_Tcl64.dll','allegro.exe']],[bases[1],'SPB_25.1',['tclsh.exe','orDb_Dll_Tcl64.dll','allegro.exe']],[bases[1],'SPB_26.1',['orDb_Dll_Tcl64.dll']]]){
    await fs.mkdir(path.join(base,name,'tools/bin'),{recursive:true});for(const file of files)await fs.writeFile(path.join(base,name,'tools/bin',file),'');
  }
  assert.equal(await detectCadence(bases),path.join(bases[1],'SPB_25.1'));
  assert.equal(await detectCadence([path.join(bases[0],'SPB_24.1')]),path.join(bases[0],'SPB_24.1'));
  assert.equal(await detectKiCad([path.join(root,'missing')]),'');
});
test('FreeCAD discovery stays in known install directories and selects the newest installed runtime',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-setup-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const name of ['FreeCAD 1.0','FreeCAD 1.1','Other']){await fs.mkdir(path.join(root,name,'bin'),{recursive:true});await fs.writeFile(path.join(root,name,'bin/python.exe'),'');}
  assert.equal(await detectFreeCAD([root]),path.join(root,'FreeCAD 1.1/bin/python.exe'));
  assert.equal(await detectFreeCAD([path.join(root,'missing')]),'');
});
test('tool preflight validates modules, KiCad version, Cadence files and AD runtime compatibility',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-tools-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'python.exe');await fs.writeFile(file,'');const input={freecadPython:file};
  await assert.rejects(checkTools({freecadPython:'relative.exe'}),/FreeCAD/);
  await assert.rejects(checkTools(input,async()=>''),/模型处理/);
  assert.match((await checkTools(input,async()=>probe)).message,/可用/);
  await assert.rejects(checkTools({...input,target:'kicad',kicadCli:file},async(_exe,args)=>args[0]==='version'?'8.0.9':probe),/KiCad 9/);
  await checkTools({...input,target:'kicad',kicadCli:file},async(_exe,args)=>args[0]==='version'?'10.0.7':probe);
  await assert.rejects(checkTools({...input,target:'cadence',cadenceRoot:root},async()=>probe),/tclsh.exe/);
  for(const name of ['tclsh.exe','orDb_Dll_Tcl64.dll','allegro.exe']){await fs.mkdir(path.join(root,'tools/bin'),{recursive:true});await fs.writeFile(path.join(root,'tools/bin',name),'');}
  await checkTools({...input,target:'cadence',cadenceRoot:root},async()=>probe);
  await assert.rejects(checkTools({...input,target:'altium'},async()=>probe.replace('[3,11]','[3,12]')),/Python 3.11/);
  let calls=0;await checkTools({...input,target:'altium'},async()=>{calls++;return probe;});assert.equal(calls,2);
});
test('selected EDA setup persists without requiring other EDA installations, and completion survives restart',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-first-run-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=await new Store(root).init();assert.equal(store.state.freecadPython,'');assert.ok(!store.state.setupCompleted);
  const python=path.join(root,'python.exe');await fs.writeFile(python,'');store.state.cadenceRoot=path.join(root,'not-installed');store.state.kicadCli=path.join(root,'not-installed.exe');
  await saveSettings(store,{freecadPython:python,altiumDir:path.join(root,'AD')},{target:'altium'});
  await fs.access(paths(store).altiumDir);assert.equal(await fs.stat(paths(store).cadenceDir).catch(()=>null),null);
  assert.ok(!(await new Store(root).init()).state.setupCompleted);
  store.state.setupCompleted=true;await store.persist();assert.equal((await new Store(root).init()).state.setupCompleted,true);
});
test('real FreeCAD and AD converter dependency preflight',{skip:!process.env.HUB_FREECAD_PYTHON},async()=>{
  const result=await checkTools({freecadPython:process.env.HUB_FREECAD_PYTHON,target:'altium'});assert.match(result.message,/通过/);
});
