const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {readComponent}=require('../src/easyeda-library.cjs'),{captureSymbol,libraryXml}=require('../src/cadence-symbol.cjs');
const {footprint,pathPoints,auditScript,checkAudit}=require('../src/cadence-footprint.cjs');
const {convertCadenceLibrary,commitFiles}=require('../src/cadence.cjs');
const fixture=id=>path.join(__dirname,'fixtures/kicad',id);

test('Capture accepts description whitespace and native ANSI conversion but rejects substantive changes',{skip:!process.env.HUB_CADENCE_ROOT||!process.env.HUB_FREECAD_PYTHON},async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-capture-description-'));
  try{
    const part=await readComponent(fixture('C5137636'));
    part.description='TMS320F2812 具有 150MHz 频率、256KB 闪存、EMIF 的 C2000™ MCU\nSecond line\tthird line\r\n';
    const rec={id:part.id,entry:'WhitespaceProbe',footprintEntry:'Pkg',...captureSymbol(part,'WhitespaceProbe','Pkg')};
    const {captureNative}=require('../src/cadence.cjs');
    const native=await captureNative([rec],'WhitespaceProbe',d,{freecadPython:process.env.HUB_FREECAD_PYTHON},process.env.HUB_CADENCE_ROOT);
    assert.ok((await fs.stat(native.olb)).size>100);
    const xml=await fs.readFile(native.roundtrip,'utf8');
    assert.ok(xml.includes('150MHz'));assert.ok(xml.includes('C2000'));
    const corrupt=xml.replace(/(name="MPN"\s+val=")[^"]*/, '$1WRONG_MPN');
    assert.notEqual(corrupt,xml);await fs.writeFile(native.roundtrip,corrupt);
    const {execFileSync}=require('node:child_process');
    assert.throws(()=>execFileSync(process.env.HUB_FREECAD_PYTHON,[path.join(__dirname,'../tools/capture_check.py'),'roundtrip',native.roundtrip,path.join(d,'expected.json')],{windowsHide:true,stdio:'pipe'}),e=>/Native symbol property mismatch.*MPN/s.test(e.stderr.toString()));
    await fs.writeFile(native.roundtrip,xml.replace('150MHz','100MHz'));
    assert.throws(()=>execFileSync(process.env.HUB_FREECAD_PYTHON,[path.join(__dirname,'../tools/capture_check.py'),'roundtrip',native.roundtrip,path.join(d,'expected.json')],{windowsHide:true,stdio:'pipe'}),e=>/Native symbol property mismatch.*Description/s.test(e.stderr.toString()));
  }finally{await fs.rm(d,{recursive:true,force:true});}
});

function powerTestSymbol(names=['VDDIO','VDDIO','VDDIO','VDD','VDD','VSS','VSS','RESET','RESET','VDD_SENSE','VDD_EN','VSS'],splitAt) {
  const rows=[['DOCTYPE','SYMBOL','1.1'],['HEAD',{}],['PART','A']];
  for(const [i,name] of names.entries()) {
    if(i===splitAt)rows.push(['PART','B']);
    rows.push(['PIN','p'+i,1,null,-10,i*10,10,0,null,0,0],['ATTR','n'+i,'p'+i,'NUMBER',String(i+1),0,1],['ATTR','a'+i,'p'+i,'NAME',name,0,1]);
    if(i===11)rows.push(['ATTR','t'+i,'p'+i,'Pin Type','NoConnect',0,1]);
  }
  return captureSymbol({id:'C123',name:'SupplyTest',description:'',properties:{Designator:'U?'},symbolRows:rows},'SupplyTest','Pkg');
}

test('duplicate pin names reserve existing names case-insensitively and restore only inferred types',()=>{
 const {applyPinNames}=require('../src/cadence-symbol.cjs');
 const symbol=powerTestSymbol(['VDD','VDD','VDD_1','VDD__1','RESET','RESET','reset_1','NC','NC']);
 assert.deepEqual(symbol.pins.map(p=>p.name),['VDD___1','VDD___2','VDD_1','VDD__1','RESET__1','RESET__2','reset_1','NC_1','NC_2']);
 assert.ok(symbol.pins.every(p=>p.type===4));assert.equal(new Set(symbol.pins.map(p=>p.name.toUpperCase())).size,symbol.pins.length);
 assert.equal(applyPinNames(symbol).xml,symbol.xml);
 const legacy={...symbol,pins:symbol.pins.map((p,i)=>({...p,type:i===0?7:p.type})),xml:symbol.xml.replace('type="4"','type="7"')};
 const repaired=applyPinNames(legacy);assert.ok(repaired.pins.every(p=>p.type===4));
 const sourcePower={...symbol,powerPinBaseTypes:symbol.powerPinBaseTypes.map((t,i)=>i===0?7:t)};
 assert.equal(applyPinNames(sourcePower).pins[0].type,7);
});

test('duplicate names are unique across units and XML replacement preserves literal special characters',()=>{
 const symbol=powerTestSymbol(['VDD','SIG$&','VDD','SIG$&'],2);
 assert.equal(symbol.units,2);assert.deepEqual(symbol.pins.map(p=>p.name),['VDD_1','SIG$&_1','VDD_2','SIG$&_2']);
 assert.match(symbol.xml,/name="SIG\$&amp;_1"/);assert.match(symbol.xml,/name="SIG\$&amp;_2"/);
});

test('Repair managed Capture library without downloading resources or changing footprint/model',{skip:!process.env.HUB_CADENCE_ROOT||!process.env.HUB_FREECAD_PYTHON,timeout:60000},async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-power-repair-'));
  try{
    const settings={cadenceRoot:process.env.HUB_CADENCE_ROOT,freecadPython:process.env.HUB_FREECAD_PYTHON,cadenceDir:path.join(d,'out'),cadenceLibraryName:'PowerRepair'};
    await fs.mkdir(settings.cadenceDir);
    const names=['VCCO_34','VCCO_34','VCCBRAM','VCCBRAM','VCCO_DDR_502','VCCO_DDR_502','RESET','RESET'];
    const record={id:'C123',entry:'SupplyTest',footprintEntry:'Pkg',...powerTestSymbol(names)};
    const native=await require('../src/cadence.cjs').captureNative([record],'PowerRepair',d,settings,settings.cadenceRoot);
    await fs.copyFile(native.olb,path.join(settings.cadenceDir,'PowerRepair.olb'));
    const files=['PowerRepair.olb','hub_cadence.json','Pkg.dra','Pkg.step'];
    for(const name of ['Pkg.dra','Pkg.step'])await fs.writeFile(path.join(settings.cadenceDir,name),'DO NOT CHANGE');
    await fs.writeFile(path.join(settings.cadenceDir,'hub_cadence.json'),JSON.stringify({schema:'eda-component-hub/cadence-v1',library:'PowerRepair',entries:[record],files}));
    // Simulate the previous version's name-inferred Power types.
    record.pins.forEach(p=>{p.type=7;});record.xml=record.xml.replaceAll('type="4"','type="7"');
    await fs.writeFile(path.join(settings.cadenceDir,'hub_cadence.json'),JSON.stringify({schema:'eda-component-hub/cadence-v1',library:'PowerRepair',entries:[record],files}));
    let result=await convertCadenceLibrary([],settings);assert.equal(result.symbolsUpdated,true);
    let state=JSON.parse(await fs.readFile(path.join(settings.cadenceDir,'hub_cadence.json')));
    assert.ok(state.entries[0].pins.every(p=>p.type===4));assert.equal(new Set(state.entries[0].pins.map(p=>p.name)).size,8);
    for(const name of ['Pkg.dra','Pkg.step'])assert.equal(await fs.readFile(path.join(settings.cadenceDir,name),'utf8'),'DO NOT CHANGE');
    result=await convertCadenceLibrary([],settings);assert.equal(result.symbolsUpdated,false);
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
test('duplicate names get suffixes while physical numbers, source types and NC remain unchanged',()=>{
 const symbol=powerTestSymbol();assert.ok(symbol.pins.every(p=>p.type===4));
 assert.deepEqual(symbol.pins.map(p=>p.number),Array.from({length:12},(_,i)=>String(i+1)));
 assert.deepEqual(symbol.pins.slice(0,3).map(p=>p.name),['VDDIO_1','VDDIO_2','VDDIO_3']);
 assert.equal(new Set(symbol.pins.map(p=>p.name)).size,12);assert.match(symbol.xml,/<IsNoConnect><Defn val="1"/);
});

test('unique supply names remain Passive after native OLB roundtrip',{skip:!process.env.HUB_CADENCE_ROOT||!process.env.HUB_FREECAD_PYTHON},async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-capture-power-'));
  try {
    const r={id:'C123',entry:'SupplyTest',footprintEntry:'Pkg',...powerTestSymbol()};
    const {captureNative}=require('../src/cadence.cjs');
    const native=await captureNative([r],'PowerTest',d,{freecadPython:process.env.HUB_FREECAD_PYTHON},process.env.HUB_CADENCE_ROOT);
    assert.ok((await fs.stat(native.olb)).size>100);
    const xml=await fs.readFile(native.roundtrip,'utf8');
    assert.equal((xml.match(/name="VDDIO_[123]"[^>]*type="4"/g)||[]).length,3);
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
test('Cadence uses MPN, physical pin identifiers, and original unit geometry',async()=>{
  const part=await readComponent(fixture('C658109')),symbol=captureSymbol(part,part.name,part.footprintTitle);
  assert.equal(symbol.pins.length,20);assert.equal(new Set(symbol.pins.map(p=>p.number)).size,20);assert.ok(symbol.xml.includes('name="ADM3057EBRWZ-RL"'));assert.ok(symbol.xml.includes('pcbFootprint="'+part.footprintTitle+'"'));assert.equal(symbol.units,1);assert.ok(libraryXml('LCSC',[symbol]).startsWith('<?xml'));
});
test('Cadence copper dimensions and circular plated drills are source based',async()=>{
  for(const id of ['C658109','C5137636','C96093']){const p=await readComponent(fixture(id)),fp=footprint(p,p.footprintTitle,'m.step');assert.equal(fp.pads.length,id==='C658109'?20:2);assert.ok(fp.commands.some(s=>s.includes('axlStepSet')));if(id==='C96093')assert.ok(fp.pads.every(p=>p.through&&p.plated&&p.drill>0));else assert.ok(fp.pads.every(p=>p.drill===0));}
});
test('Unsupported copper is rejected, not silently approximated',async()=>{const p=await readComponent(fixture('C5137636'));p.footprintRows.find(r=>r[0]==='PAD')[10][0]='POLYGON';assert.throws(()=>footprint(p,'cap','m.step'),/焊盘形状/);});
async function squareExposedPadPart(){
  const part=await readComponent(fixture('C5137636'));
  const pad=structuredClone(part.footprintRows.find(r=>r[0]==='PAD'));
  pad[1]='exposed-pad';pad[5]='3';pad[6]=0;pad[7]=0;pad[8]=0;pad[10]=['RECT',5.5/0.0254,5.5/0.0254];
  part.footprintRows.push(pad);return part;
}
test('Square exposed pad uses Allegro SQUARE, preserving 5.5 mm dimensions',async()=>{
  const fp=footprint(await squareExposedPadPart(),'QfnTest','m.step'),pad=fp.pads.find(p=>p.number==='3');
  assert.equal(pad.kind,'SQUARE');assert.equal(pad.width,5.5);assert.equal(pad.height,5.5);
});
test('Allegro native square 5.5 mm exposed pad survives DRA/PSM build and audit',{skip:!process.env.HUB_CADENCE_ROOT,timeout:60000},async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-cadence-square-'));
  try{
    const {allegroNative}=require('../src/cadence.cjs');
    const fp=await allegroNative(await squareExposedPadPart(),'QfnSquareTest',d,process.env.HUB_CADENCE_ROOT);
    assert.equal(fp.pads.find(p=>p.number==='3').kind,'SQUARE');await fs.access(path.join(d,'QfnSquareTest.psm'));
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
test('Arc approximation preserves endpoints',()=>{const p=pathPoints([10,0,'ARC',90,0,10],[]);assert.equal(p[0][0],0.254);assert.deepEqual(p.at(-1),[0,0.254]);assert.ok(p.length>10);});
test('Multi-unit vertical Capture pin labels and hollow bodies survive native OLB',{skip:!process.env.HUB_CADENCE_ROOT||!process.env.HUB_FREECAD_PYTHON},async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-capture-units-'));try{
    const rows=[['DOCTYPE','SYMBOL','1.1'],['HEAD',{}],['PART','A'],['RECT','body',-5,-5,5,5,0,0,0,'default'],['PIN','p1',1,null,0,-15,10,90,null,0,0],['ATTR','a','p1','NUMBER','1',0,1],['ATTR','b','p1','NAME','IN',0,1],['PART','B'],['RECT','body',-5,-5,5,5,0,0,0,'default'],['PIN','p1',1,null,0,15,10,270,null,0,0],['ATTR','a','p1','NUMBER','2',0,1],['ATTR','b','p1','NAME','OUT',0,1]];
    const part={id:'C123',name:'Multi',description:'',properties:{Designator:'U?'},symbolRows:rows},r={id:part.id,entry:part.name,footprintEntry:'Pkg',...captureSymbol(part,part.name,'Pkg')};
    const {captureNative}=require('../src/cadence.cjs'),s={freecadPython:process.env.HUB_FREECAD_PYTHON};const native=await captureNative([r],'UnitTest',d,s,process.env.HUB_CADENCE_ROOT);assert.ok((await fs.stat(native.olb)).size>100);const xml=await fs.readFile(native.roundtrip,'utf8');assert.ok(/fillStyle="1"/.test(xml));assert.ok(!/fillStyle="0"/.test(xml));assert.ok(/<IsPinNamesRotated>\s*<Defn val="1"/.test(xml));assert.ok(r.pins.every(p=>p.hotptX===p.startX));
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
test('Managed commit rolls back if a later destination conflicts',async()=>{const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-cadence-rollback-'));try{await fs.writeFile(path.join(d,'a'),'old');await fs.writeFile(path.join(d,'b'),'user');await assert.rejects(commitFiles(d,new Map([['a',Buffer.from('new')],['b',Buffer.from('bad')]]),new Set(['a'])),/同名/);assert.equal(await fs.readFile(path.join(d,'a'),'utf8'),'old');assert.equal(await fs.readFile(path.join(d,'b'),'utf8'),'user');}finally{await fs.rm(d,{recursive:true,force:true});}});
test('Real Capture/Allegro: cumulative OLB, SMD/THT, failed retry and portable model', {skip:!process.env.HUB_CADENCE_ROOT||!process.env.HUB_FREECAD_PYTHON,timeout:180000},async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-cadence-test-'));
  try {
    const settings={cadenceRoot:process.env.HUB_CADENCE_ROOT,cadenceDir:path.join(d,'library'),cadenceLibraryName:'MyParts',freecadPython:process.env.HUB_FREECAD_PYTHON};
    const resources=[];for(const id of ['C658109','C5137636','C96093']){const folder=path.join(d,id);await fs.cp(fixture(id),folder,{recursive:true});resources.push({id,folder});}
    let report=await convertCadenceLibrary(resources.slice(0,2),settings);assert.deepEqual(report.results.map(r=>[r.id,r.status,r.message]),[['C658109','converted',undefined],['C5137636','converted',undefined]]);
    const legacyIndex=path.join(settings.cadenceDir,'hub_cadence.json'),legacy=JSON.parse(await fs.readFile(legacyIndex,'utf8'));
    for(const entry of legacy.entries)entry.xml=entry.xml.replaceAll('fillStyle="1"','fillStyle="0"').replace('<IsPinNamesRotated><Defn val="1"/>','<IsPinNamesRotated><Defn val="0"/>');
    for(const name of ['MyParts.xml','MyParts_roundtrip.xml','MyParts_review.dsn','MyParts_placed_pins.tsv']){legacy.files.push(name);await fs.writeFile(path.join(settings.cadenceDir,name),'old generated auxiliary file');}await fs.writeFile(legacyIndex,JSON.stringify(legacy));
    report=await convertCadenceLibrary(resources.slice(2),settings);assert.equal(report.converted,1,JSON.stringify(report));
    assert.ok(!(await fs.readdir(settings.cadenceDir)).some(name=>/\.(dsn|tsv|xml)$/i.test(name)));
    const state=JSON.parse(await fs.readFile(path.join(settings.cadenceDir,'hub_cadence.json'),'utf8'));assert.equal(state.entries.length,3);assert.equal(state.library,'MyParts');assert.ok(state.entries.every(e=>!e.xml.includes('fillStyle="0"') && e.xml.includes('<IsPinNamesRotated><Defn val="1"/>')));
    const prior=await fs.readFile(path.join(settings.cadenceDir,'MyParts.olb'));await fs.writeFile(path.join(resources[0].folder,'device.elibz'),'broken');report=await convertCadenceLibrary(resources.slice(0,1),settings);assert.equal(report.converted,1);assert.equal(report.results[0].reused,true);assert.deepEqual(await fs.readFile(path.join(settings.cadenceDir,'MyParts.olb')),prior);
    const capRecord=state.entries.find(e=>e.id==='C5137636'),capDra=path.join(settings.cadenceDir,capRecord.footprintEntry+'.dra');
    const draBytes=await fs.readFile(capDra);await fs.unlink(path.join(settings.cadenceDir,capRecord.modelName));
    const modelRepair=await convertCadenceLibrary([resources[1]],settings);assert.equal(modelRepair.converted,1,JSON.stringify(modelRepair));assert.equal(modelRepair.results[0].reusedFootprint,true);
    assert.deepEqual(await fs.readFile(capDra),draBytes);assert.deepEqual(await fs.readFile(path.join(settings.cadenceDir,'MyParts.olb')),prior);
    await fs.unlink(path.join(settings.cadenceDir,capRecord.footprintEntry+'.psm'));
    const psmRepair=await convertCadenceLibrary([resources[1]],settings);assert.equal(psmRepair.converted,1,JSON.stringify(psmRepair));
    assert.deepEqual(await fs.readFile(capDra),draBytes);assert.deepEqual(await fs.readFile(path.join(settings.cadenceDir,'MyParts.olb')),prior);
    const moved=path.join(d,'moved library');await fs.cp(settings.cadenceDir,moved,{recursive:true});
    const cap=state.entries.find(e=>e.id==='C5137636'),il=path.join(moved,'portable.il');await fs.writeFile(il,auditScript(cap.pads,cap.modelName));await fs.writeFile(path.join(moved,'portable.scr'),'skill load('+JSON.stringify(il.replaceAll('\\','/'))+')\n');
    const {spawnSync}=require('node:child_process');const native=spawnSync(path.join(settings.cadenceRoot,'tools/bin/allegro.exe'),['-nograph','-safe','-symbol','package','-s','portable.scr',cap.footprintEntry+'.dra'],{cwd:moved,windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(native.status,0,native.stdout+native.stderr);await fs.access(path.join(moved,'audit.ok'));checkAudit(await fs.readFile(path.join(moved,'audit.tsv'),'utf8'),cap.pads,cap.modelName);
  } finally{await fs.rm(d,{recursive:true,force:true});}
});

function addMaskWindows(part) {
  // A split paste window on pad 1, a circular bottom opening with a void,
  // and a rotated rounded rectangle outside the pads.
  part.footprintRows.push(
    ['FILL','paste-a','',0,7,0,0,[[-36,13,'L',-30,13,-30,-13,-36,-13,-36,13]]],
    ['FILL','paste-b','',0,7,0,0,[[-27,13,'L',-21,13,-21,-13,-27,-13,-27,13]]],
    ['FILL','bottom','',0,8,0,0,[['CIRCLE',100,100,20,0],['CIRCLE',100,100,5,1]]],
    ['FILL','rounded','',0,7,0,0,[['R',150,150,30,20,30,0,3]]],
    ['FILL','top-mask','',0,5,0,0,[[19,14,'L',38,14,38,-14,19,-14,19,14]]],
    ['FILL','bottom-mask','',0,6,0,0,[['CIRCLE',200,100,10,0]]]
  );
  return part;
}
test('Explicit paste windows preserve filled geometry and suppress overlapping pad default paste',async()=>{
  const part=addMaskWindows(await readComponent(fixture('C5137636'))),fp=footprint(part,'Pkg','m.step');
  assert.equal(fp.fills.length,6);assert.equal(fp.fills[2].paths.length,2);
  assert.ok(fp.commands.some(c=>c.includes('axlDBCreateVoid')));
  assert.ok(fp.commands.some(c=>c.includes('PACKAGE GEOMETRY/PASTEMASK_TOP')));
  assert.ok(fp.commands.some(c=>c.includes('PACKAGE GEOMETRY/PASTEMASK_BOTTOM')));
  assert.equal(fp.pads.filter(p=>p.explicitPaste).length,1);
  const first=fp.pads.find(p=>p.explicitPaste),definition=fp.commands.find(c=>c.includes('axlDBCreatePadStack("'+first.padName+'"'));
  assert.ok(definition.includes('PASTEMASK_TOP'));assert.ok(definition.includes("?figure 'NULL ?figureSize 0:0"));assert.ok(definition.includes('SOLDERMASK_TOP'));
  assert.ok(auditScript(fp.pads,'m.step',fp.fills).includes('Native mask shape count mismatch'));
});
test('Allegro native paste fills, inner voids and split windows survive DRA/PSM generation',{skip:!process.env.HUB_CADENCE_ROOT,timeout:60000},async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-cadence-fill-'));
  try {
    const part=addMaskWindows(await readComponent(fixture('C5137636')));
    const {allegroNative}=require('../src/cadence.cjs');
    const fp=await allegroNative(part,'PasteTest',d,process.env.HUB_CADENCE_ROOT);
    assert.equal(fp.fills.length,6);assert.ok((await fs.stat(path.join(d,'PasteTest.psm'))).size>100);
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
