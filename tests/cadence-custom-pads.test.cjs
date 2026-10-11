const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {padGeometry,area,checkShapeAudit}=require('../src/cadence-custom-pads.cjs');
const {pathPoints,footprint}=require('../src/cadence-footprint.cjs');
const row=(shape,x=0,y=0,angle=0)=>['PAD','p',0,'',1,'1',x,y,angle,null,shape,0,0,0,0,0];
const polygon=['POLY',[10,20,'L',50,20,50,40,30,40,30,60,10,60,10,20]];
test('custom contours keep pad anchor, curvature and independent orientation',()=>{
  const p=padGeometry(polygon,row(polygon,20,30,90),[]);
  assert.equal(p.kind,'SHAPE');assert.deepEqual(p.points[0],[-0.254,-0.254]);
  assert.equal(p.width,1.016);assert.equal(p.height,1.016);assert.ok(Math.abs(area(p.points)-0.774192)<1e-10);
  const fp=footprint({footprintRows:[row(polygon,20,30,90)]},'Pkg','model.step');
  assert.equal(fp.pads[0].angle,90);assert.equal(fp.shapes.length,1);
  assert.ok(fp.commands.some(c=>c.includes('?figure "hub_shape_')));
  assert.equal(fp.commands.filter(c=>c.includes('?layer "PASTEMASK_TOP"')).length,1);
});
test('ellipse, rounded rectangle and regular polygon remain distinct outlines',()=>{
  for(const shape of [['ELLIPSE',100,40],['RECT',100,40,25],['NGON',100,6]]){
    const p=padGeometry(shape,row(shape),[]);assert.equal(p.kind,'SHAPE');assert.ok(p.points.length>=7);
    assert.ok(area(p.points)<p.width*p.height);assert.ok(area(p.points)>p.width*p.height/2);
  }
  assert.equal(padGeometry(['OVAL',100,40],row(['OVAL',100,40]),[]).kind,'OBLONG_X');
});
test('curved paths support circular arcs and bounded cubic Bezier subdivision',()=>{
  const curve=[0,0,'C',0,40,40,40,40,0,'L',0,0];const pts=pathPoints(curve,[]);
  assert.deepEqual(pts[0],[0,0]);assert.deepEqual(pts.at(-1),[0,0]);assert.ok(pts.length>10);
  assert.ok(Math.abs(Math.max(...pts.map(p=>p[1]))-0.762)<0.002);
  assert.deepEqual(pathPoints([0,0,'ARC',90,40,40],[]),pathPoints([0,0,'CARC',90,40,40],[]));
  assert.equal(padGeometry(['POLYGON',curve],row(['POLYGON',curve]),[]).kind,'SHAPE');
});
test('shape audit rejects shifted or substituted contours and invalid holes fail explicitly',()=>{
  const p={...padGeometry(polygon,row(polygon,20,30),[]),padName:'pad',number:'1'};
  const text=p.points.map(([x,y])=>`pad\t${x}\t${y}`).join('\n');assert.doesNotThrow(()=>checkShapeAudit(text,[p]));
  assert.throws(()=>checkShapeAudit(p.points.map(([x,y])=>`pad\t${x+0.1}\t${y}`).join('\n'),[p]),/轮廓回读不一致/);
  assert.throws(()=>padGeometry(['POLY',[[0,0,'L',40,0,40,40,0,40],[10,10,'L',20,10,20,20,10,20]]],row(polygon),[]),/内孔或多个轮廓/);
  assert.throws(()=>padGeometry(['POLY',[0,0,'L',40,40,40,0,0,40,0,0]],row(polygon),[]),/退化|自相交/);
});
test('Allegro native curved and rotated custom pads retain their vertices and portable SSM dependencies',{skip:!process.env.HUB_CADENCE_ROOT,timeout:180000},async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-custom-pads-'));
  try{
    const {readComponent}=require('../src/easyeda-library.cjs'),{allegroNative}=require('../src/cadence.cjs');
    const base=await readComponent(path.join(__dirname,'fixtures/kicad/C5137636'));
    const shapes=[['ELLIPSE',100,40],['RECT',100,40,25],['NGON',80,6],['POLYGON',[0,0,'C',0,40,40,40,40,0,'L',0,0]]];
    const rows=shapes.map((s,i)=>{const r=row(s,0,0,i*90);r[5]=String(i+1);r[6]=i*150;if(s[0]==='POLYGON')r[6]=0;r[7]=i*150;if(s[0]==='POLYGON')r[7]=0;return r;});
    const native=await allegroNative({...base,footprintRows:rows},'Custom',d,process.env.HUB_CADENCE_ROOT);
    assert.equal(native.shapes.length,4);assert.equal(native.files.filter(f=>f.endsWith('.ssm')).length,4);
    for(const f of native.files)assert.ok((await fs.stat(path.join(d,f))).size>0);
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
test('C2915308 actual four custom pads pass native DRA/PSM copper audit',{skip:!process.env.HUB_CADENCE_ROOT,timeout:180000},async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-C2915308-pads-'));
  try{
    const {readComponent}=require('../src/easyeda-library.cjs'),{allegroNative}=require('../src/cadence.cjs');
    const base=await readComponent(path.join(__dirname,'fixtures/kicad/C5137636'));
    const rows=JSON.parse(await fs.readFile(path.join(__dirname,'fixtures/cadence/C2915308-footprint.json'),'utf8'));
    const result=await allegroNative({...base,footprintRows:rows},'ActualCustom',d,process.env.HUB_CADENCE_ROOT);
    assert.equal(result.pads.length,4);assert.equal(result.shapes.length,4);
    assert.ok(result.pads.every(p=>p.kind==='SHAPE'));
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
test('cumulative Cadence export packages SSM and repairs a missing shape without replacing OLB',{skip:!process.env.HUB_CADENCE_ROOT||!process.env.HUB_FREECAD_PYTHON,timeout:180000},async()=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'hub-custom-library-'));
  try{
    const JSZip=require('jszip'),{convertCadenceLibrary}=require('../src/cadence.cjs');
    const folder=path.join(d,'resource');await fs.cp(path.join(__dirname,'fixtures/kicad/C5137636'),folder,{recursive:true});
    const file=path.join(folder,'footprint.elibz'),zip=await JSZip.loadAsync(await fs.readFile(file));
    const source=Object.keys(zip.files).find(n=>n.endsWith('.efoo'));
    const rows=(await zip.file(source).async('string')).trim().split(/\r?\n/).map(JSON.parse);
    const pads=rows.filter(r=>r[0]==='PAD');pads[0][10]=['ELLIPSE',40,20];pads[1][10]=['RECT',40,20,25];
    zip.file(source,rows.map(JSON.stringify).join('\n'));await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
    const settings={cadenceRoot:process.env.HUB_CADENCE_ROOT,freecadPython:process.env.HUB_FREECAD_PYTHON,cadenceDir:path.join(d,'out')};
    const resources=[{id:'C5137636',folder}];const first=await convertCadenceLibrary(resources,settings);
    assert.equal(first.converted,1,JSON.stringify(first));
    const index=JSON.parse(await fs.readFile(path.join(settings.cadenceDir,'hub_cadence.json'))),shape=index.files.find(f=>f.endsWith('.ssm'));
    assert.ok(shape);const olb=await fs.readFile(path.join(settings.cadenceDir,'LCSC.olb'));
    const existing=require('../src/existing-library.cjs').existingLibrary;
    assert.ok((await existing('cadence',['C5137636'],settings)).get('C5137636').complete);
    const bytes=await fs.readFile(path.join(settings.cadenceDir,shape));await fs.unlink(path.join(settings.cadenceDir,shape));
    assert.equal((await existing('cadence',['C5137636'],settings)).get('C5137636').complete,false);
    const repaired=await convertCadenceLibrary(resources,settings);assert.equal(repaired.converted,1,JSON.stringify(repaired));
    assert.ok((await fs.stat(path.join(settings.cadenceDir,shape))).size>100);
    assert.deepEqual(await fs.readFile(path.join(settings.cadenceDir,'LCSC.olb')),olb);
    assert.ok((await existing('cadence',['C5137636'],settings)).get('C5137636').complete);
    assert.ok(bytes.length>100);
  }finally{await fs.rm(d,{recursive:true,force:true});}
});
