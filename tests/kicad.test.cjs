const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {readComponent}=require('../src/easyeda-library.cjs');const {convertSymbol}=require('../src/kicad-symbol.cjs');const {normalizeFootprint,convertLibrary}=require('../src/kicad.cjs');const sx=require('../src/sexpr.cjs');
const fixtures=path.join(__dirname,'fixtures/kicad');
test('original device archive resolves exact associations, properties, pin numbers and units',async()=>{
  const p=await readComponent(path.join(fixtures,'C658109'));assert.equal(p.id,'C658109');assert.equal(p.name,'ADM3057EBRWZ-RL');
  const symbol=convertSymbol(p,'C658109_ADM3057','TestLib');assert.equal(symbol.pins.length,20);assert.equal(symbol.units,1);
  assert.deepEqual(symbol.pins.map(x=>x.number),Array.from({length:20},(_,i)=>String(i+1)));
  assert.deepEqual([symbol.pins[0].x,symbol.pins[0].y,symbol.pins[0].length,symbol.pins[0].angle],[-15.24,11.43,2.54,0]);
  assert.ok(symbol.text.includes('TestLib:C658109_ADM3057'));assert.ok(symbol.text.includes('ADI(亚德诺)'));sx.parse(symbol.text);
});
test('tiny surface-pad placeholder holes are removed while real THT holes are preserved',async()=>{
  const smd=await readComponent(path.join(fixtures,'C658109'));const normalized=normalizeFootprint(smd.footprintRows);
  assert.equal(normalized.pads.length,20);assert.ok(normalized.pads.every(x=>x[9]===null));assert.equal(normalized.warnings.length,1);
  const tht=await readComponent(path.join(fixtures,'C96093'));const holes=tht.footprintRows.filter(x=>x[0]==='PAD').map(x=>structuredClone(x[9]));
  assert.deepEqual(normalizeFootprint(tht.footprintRows).pads.map(x=>x[9]),holes);
  const contradictory=['PAD','e1',0,'',1,'1',0,0,0,['ROUND',39.37,39.37],['ROUND',70,70],[],0,0,0,1];
  assert.throws(()=>normalizeFootprint([contradictory]),/真实尺寸孔/);
});
test('multi-unit symbols preserve separate pin mappings and reject unsupported content',()=>{
  const rows=[['DOCTYPE','SYMBOL','1.1'],['HEAD',{originX:0,originY:0}],['PART','A'],['PIN','p1',1,null,-10,0,10,0,null,0,0],['ATTR','a','p1','NUMBER','1',0,1],['ATTR','b','p1','NAME','IN',0,1],['PART','B'],['PIN','p1',1,null,10,0,10,180,null,0,0],['ATTR','a','p1','NUMBER','2',0,1],['ATTR','b','p1','NAME','OUT',0,1]];
  const part={id:'C123',name:'multi',properties:{Designator:'U?'},symbolRows:rows};const converted=convertSymbol(part,'C123_multi','Test');
  assert.equal(converted.units,2);assert.deepEqual(converted.pins.map(x=>[x.unit,x.number,x.name]),[[1,'1','IN'],[2,'2','OUT']]);
  assert.equal(sx.children(sx.parse(converted.text),'symbol').length,2);
  assert.throws(()=>convertSymbol({...part,symbolRows:[...rows,['OBJ','image']]},'C123_multi','Test'),/不支持符号图元/);
});
test('KiCad real conversion covers SMD, THT and 20-pin IC with valid libraries and preserved originals',{skip:!process.env.HUB_KICAD_CLI},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-kicad-test-'));const resources=[];const hashes=[];
  for(const id of ['C5137636','C96093','C658109']){const folder=path.join(root,id);await fs.mkdir(folder);for(const name of ['manifest.json','device.elibz','footprint.elibz',id+'_mount_z0.step'])await fs.copyFile(path.join(fixtures,id,name),path.join(folder,name));await fs.writeFile(path.join(folder,'component.json'),JSON.stringify({id,conversions:{cadence:'not_implemented'}}));resources.push({id,folder});hashes.push(await fs.readFile(path.join(folder,'device.elibz')));}
  const result=await convertLibrary(resources,{kicadCli:process.env.HUB_KICAD_CLI,kicadDir:path.join(root,'output')});assert.equal(result.converted,3);assert.equal(result.failed,0);
  const symbolLib=sx.parse(await fs.readFile(path.join(result.folder,result.library+'.kicad_sym'),'utf8'));assert.equal(sx.children(symbolLib,'symbol').length,3);
  const reports=result.results;assert.ok(reports.find(x=>x.id==='C5137636').geometry.footprintPads.every(x=>x.type==='smd'));assert.ok(reports.find(x=>x.id==='C96093').geometry.footprintPads.every(x=>x.type==='thru_hole'));
  for(let i=0;i<resources.length;i++){
    assert.deepEqual(await fs.readFile(path.join(resources[i].folder,'device.elibz')),hashes[i]);
    const report=reports[i];const fp=sx.parse(await fs.readFile(path.join(result.folder,report.footprintLibrary+'.pretty',report.footprintEntry+'.kicad_mod'),'utf8'));
    const part=await readComponent(resources[i].folder);assert.equal(report.entry,part.name);assert.equal(report.footprintEntry,part.footprintTitle);
    const sym=sx.children(symbolLib,'symbol').find(s=>sx.value(s)===report.entry);const binding=sx.children(sym,'property').find(p=>sx.value(p)==='Footprint');assert.equal(sx.value(binding,2),'LCSC:'+part.footprintTitle);
    assert.equal(sx.value(sx.child(fp,'model')),'kicad-embed://'+report.id+'.step');await fs.access(path.join(result.folder,report.model.path));
    const embedded=sx.children(sx.child(fp,'embedded_files'),'file')[0];
    const encoded=sx.value(sx.child(embedded,'data')).slice(1,-1);
    assert.deepEqual(require('node:zlib').zstdDecompressSync(Buffer.from(encoded,'base64')),await fs.readFile(path.join(result.folder,report.model.path)));
    const meta=JSON.parse(await fs.readFile(path.join(resources[i].folder,'component.json'),'utf8'));assert.equal(meta.conversions.kicad.status,'converted');assert.equal(meta.conversions.cadence,'not_implemented');
  }
  const originalSymbol=await fs.readFile(path.join(result.folder,'LCSC.kicad_sym'));
  const cached=await convertLibrary([{id:resources[0].id,folder:path.join(root,'not-downloaded')}],{kicadCli:process.env.HUB_KICAD_CLI,kicadDir:result.folder});
  assert.equal(cached.results[0].reused,true);assert.deepEqual(await fs.readFile(path.join(result.folder,'LCSC.kicad_sym')),originalSymbol);
  const firstReport=result.results[0],firstFp=path.join(result.folder,'LCSC.pretty',firstReport.footprintEntry+'.kicad_mod');
  const fpBytes=await fs.readFile(firstFp);await fs.unlink(path.join(result.folder,'LCSC.3dshapes',resources[0].id+'.step'));
  const modelRepair=await convertLibrary([resources[0]],{kicadCli:process.env.HUB_KICAD_CLI,kicadDir:result.folder});
  assert.equal(modelRepair.failed,0);assert.equal(modelRepair.results[0].reusedFootprint,true);assert.deepEqual(await fs.readFile(firstFp),fpBytes);assert.deepEqual(await fs.readFile(path.join(result.folder,'LCSC.kicad_sym')),originalSymbol);
  await fs.unlink(firstFp);const fpRepair=await convertLibrary([resources[0]],{kicadCli:process.env.HUB_KICAD_CLI,kicadDir:result.folder});
  assert.equal(fpRepair.failed,0);assert.equal(fpRepair.results[0].reusedSymbol,true);assert.deepEqual(await fs.readFile(path.join(result.folder,'LCSC.kicad_sym')),originalSymbol);
  const failed=await convertLibrary([{id:'C999',folder:path.join(root,'missing')},resources[0]],{kicadCli:process.env.HUB_KICAD_CLI,kicadDir:path.join(root,'output')});assert.equal(failed.failed,1);assert.equal(failed.converted,1);
  assert.equal(failed.folder,result.folder);assert.equal(result.library,'LCSC');
  const preserved=sx.parse(await fs.readFile(path.join(result.folder,'LCSC.kicad_sym'),'utf8'));assert.equal(sx.children(preserved,'symbol').length,3);
  assert.deepEqual(sx.children(preserved,'symbol').map(x=>sx.value(x)).sort(),['ADM3057EBRWZ-RL','FCC0603B104K500CT','TMB12A05']);
  assert.match(await fs.readFile(path.join(result.folder,'fp-lib-table'),'utf8'),/\$\{KIPRJMOD\}/);
  await assert.rejects(convertLibrary([{id:'C999',folder:path.join(root,'missing')}],{kicadCli:process.env.HUB_KICAD_CLI,kicadDir:path.join(root,'output')}),/原库已保留/);
  assert.equal(sx.children(sx.parse(await fs.readFile(path.join(result.folder,'LCSC.kicad_sym'),'utf8')),'symbol').length,3);
  // Preserve existing legacy names while rebinding the configured footprint library.
  const capacitor=await readComponent(resources[0].folder),oldTree=sx.parse(await fs.readFile(path.join(result.folder,'LCSC.kicad_sym'),'utf8'));
  const oldIndex=oldTree.findIndex(s=>sx.name(s)==='symbol'&&sx.value(s)===capacitor.name);oldTree[oldIndex]=sx.parse(convertSymbol(capacitor,capacitor.id,'LCSC').text);
  await fs.writeFile(path.join(result.folder,'LCSC.kicad_sym'),sx.write(oldTree));
  await fs.rename(path.join(result.folder,'LCSC.pretty','C0603.kicad_mod'),path.join(result.folder,'LCSC.pretty','C5137636.kicad_mod'));
  const renamed=await convertLibrary([resources[0]],{kicadCli:process.env.HUB_KICAD_CLI,kicadDir:path.join(root,'output'),kicadFootprintLibraryName:'MyParts'});assert.equal(renamed.failed,0);assert.equal(renamed.converted,1);
  const rebound=sx.children(sx.parse(await fs.readFile(path.join(result.folder,'LCSC.kicad_sym'),'utf8')),'symbol');assert.equal(rebound.length,3);
  assert.ok(rebound.every(s=>sx.value(sx.children(s,'property').find(p=>sx.value(p)==='Footprint'),2).startsWith('MyParts:')));
  assert.ok(rebound.some(s=>sx.value(s)==='C5137636'));
  await fs.access(path.join(result.folder,'MyParts.pretty','C5137636.kicad_mod'));
  assert.match(await fs.readFile(path.join(result.folder,'fp-lib-table'),'utf8'),/\(name "MyParts"\)/);
  for(const s of rebound){const name=sx.value(sx.children(s,'property').find(p=>sx.value(p)==='Footprint'),2).split(':')[1];await fs.access(path.join(result.folder,'MyParts.pretty',name+'.kicad_mod'));}
  // Move the complete library, then use its footprint from an unrelated project.
  const moved=path.join(root,'relocated library');await fs.rename(result.folder,moved);
  const python=path.join(path.dirname(process.env.HUB_KICAD_CLI),'python.exe');
  const project=path.join(root,'unrelated-project');const config=path.join(root,'isolated-config');await fs.mkdir(config);
  await require('../src/kicad.cjs').run(python,[path.join(__dirname,'kicad-portable.py'),project,path.join(moved,'MyParts.pretty'),'C5137636'],config);
  const step=path.join(project,'output.step');
  const nativeLog=await require('../src/kicad.cjs').run(process.env.HUB_KICAD_CLI,['pcb','export','step','--output',step,path.join(project,'test.kicad_pcb')],config);
  assert.ok(!/File not found|Could not add 3D model/.test(nativeLog),nativeLog);
  assert.ok((await fs.stat(step)).size>1000);
});
test('same-name entries get descriptive collision suffixes and library names reject paths',()=>{
  const {libraryName,uniqueName}=require('../src/kicad-names.cjs');
  assert.equal(uniqueName('C0603','C2',new Map([['C0603','C1']]),'Capacitor100nF'),'C0603_Capacitor100nF');
  assert.equal(uniqueName('ADM3057','C1',new Map([['ADM3057','C1']]),'ADI'),'ADM3057');
  assert.equal(libraryName('我的封装库'),'我的封装库');assert.throws(()=>libraryName('foo:bar'),/封装库名称/);assert.throws(()=>libraryName('../foo'),/封装库名称/);
});
