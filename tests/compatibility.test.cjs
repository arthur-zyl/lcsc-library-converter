const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),JSZip=require('jszip');
const {rectanglePoints,ellipsePoints}=require('../src/symbol-geometry.cjs'),{convertSymbol}=require('../src/kicad-symbol.cjs'),{captureSymbol}=require('../src/cadence-symbol.cjs'),{geometry}=require('../src/altium-geometry.cjs'),{readComponent}=require('../src/easyeda-library.cjs');
test('rotated rectangle rotates about point 1, including reversed corners',()=>{
 assert.deepEqual(rectanglePoints(['RECT','r',10,20,30,40,0,0,90]).map(v=>Math.round(v)),[10,20,10,40,-10,40,-10,20]);
 assert.deepEqual(rectanglePoints(['RECT','r',30,40,10,20,0,0,90]).map(v=>Math.round(v)),[50,20,50,40,30,40,30,20]);
 assert.throws(()=>rectanglePoints(['RECT','r',0,0,10,10,-1,2,0]),/无效/);
});
test('rounded rectangles and ellipses preserve endpoints and bound curve approximation error',()=>{
 const points=rectanglePoints(['RECT','r',0,0,40,20,4,2,0]);assert.ok(points.length>32);assert.equal(points[0],40);assert.equal(points[1],18);
 const ellipse=ellipsePoints(0,0,100,50,0),n=ellipse.length/2;assert.ok(0.254*100*(1-Math.cos(Math.PI/n))<=0.00200001);
});
test('shared symbol geometry converts round/rotated bodies for KiCad, Capture and AD',async()=>{
 const part=await readComponent(path.join(__dirname,'fixtures/kicad/C5137636'));part.symbolRows.push(['RECT','compat',-20,-10,20,10,4,3,35,null,0]);
 assert.match(convertSymbol(part,'Compat','Test').text,/polyline/);assert.match(captureSymbol(part,'Compat','Footprint').xml,/PolylinePoint/);assert.ok(geometry(part,'Compat','Footprint').units.some(u=>u.graphics.some(g=>g.type==='polyline')));
});
for(const [target,converter,enabled] of [
 ['kicad',require('../src/kicad.cjs').convertLibrary,process.env.HUB_KICAD_CLI],
 ['cadence',require('../src/cadence.cjs').convertCadenceLibrary,process.env.HUB_CADENCE_ROOT && process.env.HUB_FREECAD_PYTHON],
 ['altium',require('../src/altium.cjs').convertAltiumLibrary,process.env.HUB_FREECAD_PYTHON]
])test(target+' native rounded/rotated symbol and stop after current component',{skip:!enabled,timeout:180000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-compatibility-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const resources=[];
 for(const id of ['C5137636','C658109']){
  const folder=path.join(root,id);await fs.mkdir(folder);for(const name of ['manifest.json','device.elibz','footprint.elibz',id+'_mount_z0.step'])await fs.copyFile(path.join(__dirname,'fixtures/kicad',id,name),path.join(folder,name));
  const file=path.join(folder,'device.elibz'),zip=await JSZip.loadAsync(await fs.readFile(file)),name=Object.keys(zip.files).find(n=>n.endsWith('.esym'));zip.file(name,(await zip.file(name).async('string'))+'\n'+JSON.stringify(['RECT','compatibility-rectangle',-20,-10,20,10,4,3,35,null,0]));await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));resources.push({id,folder});
 }
 const settings={freecadPython:process.env.HUB_FREECAD_PYTHON,kicadCli:process.env.HUB_KICAD_CLI,cadenceRoot:process.env.HUB_CADENCE_ROOT,[target+'Dir']:path.join(root,'library')};let stop=false;const progress=[];
 const result=await converter(resources,settings,()=>{},{isStopped:()=>stop,onProgress:p=>{progress.push(p);if(p.completed===1)stop=true;}});
 assert.equal(result.converted,1,JSON.stringify(result));assert.equal(result.results.length,1);assert.ok(progress.some(p=>p.completed===1));await fs.access(path.join(settings[target+'Dir'],'LCSC.'+({kicad:'kicad_sym',cadence:'olb',altium:'SchLib'}[target])));
});
