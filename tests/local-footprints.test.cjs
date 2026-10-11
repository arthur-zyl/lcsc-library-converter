const test=require('node:test'),assert=require('node:assert/strict');
const {key,matchFootprint,modelPlacement,useKiCadFootprint}=require('../src/local-footprints.cjs');
test('KiCad model rotation reverses the geometric alignment angle, keeping XY offsets',()=>{
 const source=[['PAD',null,null,null,1,'1',-1/0.0254,0],['PAD',null,null,null,1,'2',1/0.0254,0]];
 for(const angle of [90,-90,45,180]){
  const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  const text=`(footprint "Native" (pad "1" smd rect (at ${5-c} ${-(8-s)}) (size 1 1)) (pad "2" smd rect (at ${5+c} ${-(8+s)}) (size 1 1)))`;
  const result=useKiCadFootprint(text,{name:'Probe'},'Probe','model.step',source);
  assert.ok(Math.abs(result.placement.angle+angle)<1e-8);assert.ok(Math.abs(result.placement.x-5)<1e-8);assert.ok(Math.abs(result.placement.y-8)<1e-8);
 }
});
test('KiCad native STEP puts an asymmetric model at the rotated target location',{skip:!process.env.HUB_KICAD_CLI||!process.env.HUB_FREECAD_PYTHON,timeout:60000},async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-rotation-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const python=process.env.HUB_FREECAD_PYTHON,cli=process.env.HUB_KICAD_CLI,model=path.join(root,'model.step');
 const run=(exe,args)=>execFileSync(exe,args,{cwd:root,windowsHide:true,encoding:'utf8'});
 run(python,['-c',`import FreeCAD as A,Part\nd=A.newDocument('Model');o=d.addObject('Part::Feature','Asymmetric');o.Shape=Part.makeBox(1,1,1,A.Vector(2,0,0));d.recompute();Part.export([o],${JSON.stringify(model)});A.closeDocument(d.Name)`]);
 const text='(footprint "Native" (layer "F.Cu") (pad "1" smd rect (at 0 1) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask")) (pad "2" smd rect (at 0 -1) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask")))';
 const source=[['PAD',null,null,null,1,'1',-1/0.0254,0],['PAD',null,null,null,1,'2',1/0.0254,0]];
 const library=path.join(root,'Test.pretty');await fs.mkdir(library);await fs.writeFile(path.join(library,'Probe.kicad_mod'),useKiCadFootprint(text,{name:'Probe'},'Probe',model,source).text);
 run(path.join(path.dirname(cli),'python.exe'),[path.join(__dirname,'kicad-portable.py'),path.join(root,'board'),library,'Probe']);
 const step=path.join(root,'output.step');run(cli,['pcb','export','step','--output',step,path.join(root,'board','test.kicad_pcb')]);
 const output=run(python,['-c',`import FreeCAD as A,Import,json\nd=A.newDocument('Read');Import.insert(${JSON.stringify(step)},d.Name)\nfor o in d.Objects:\n if o.TypeId=='Part::Feature' and abs(o.Shape.Volume-1)<1e-6:\n  s=o.Shape.copy();s.Placement=o.getGlobalPlacement().multiply(o.Placement.inverse()).multiply(s.Placement);print('CENTER '+json.dumps(list(s.CenterOfMass)))`]);
 const centers=output.split(/\r?\n/).filter(l=>l.startsWith('CENTER ')).map(l=>JSON.parse(l.slice(7)));assert.equal(centers.length,1);
 assert.ok(Math.abs(centers[0][0]+0.5)<1e-6);assert.ok(Math.abs(centers[0][1]-2.5)<1e-6);
});
test('simple aliases match SOP/SOIC and capacitor names without choosing ambiguous variants',()=>{
  assert.equal(key('sop-8'),key('SOIC_8'));
  assert.equal(matchFootprint('C0603',[{name:'smc0603',file:'cap.dra'}]).file,'cap.dra');
  assert.equal(matchFootprint('SOP-8',[{name:'soic8',file:'sop.dra'}]).file,'sop.dra');
  assert.equal(matchFootprint('C0603',[{name:'C_0603_1608Metric'},{name:'C_0603_1608Metric_Pad1x1_HandSolder'}]).name,'C_0603_1608Metric');
  assert.equal(matchFootprint('QFN-32',[{name:'QFN32_5x5mm_P0.5mm'},{name:'QFN32_6x6mm_P0.5mm'}]),undefined);
  assert.equal(matchFootprint('QFN-32_L5-W5-P0.5',[{name:'QFN32_5x5mm_P0.5mm'},{name:'QFN32_6x6mm_P0.5mm'}]).name,'QFN32_5x5mm_P0.5mm');
});
test('STEP alignment uses pin numbers and permits different pad dimensions and holes',()=>{
  const source=[{number:'1',x:-1,y:0},{number:'2',x:1,y:0}];
  const target=[{number:'2',x:5,y:9,width:2,drill:0.8},{number:'1',x:5,y:7,width:3,drill:1}];
  const result=modelPlacement(source,target);assert.equal(result.x,5);assert.equal(result.y,8);assert.equal(result.angle,90);
  assert.throws(()=>modelPlacement(source,[{number:'1',x:0,y:0},{number:'3',x:2,y:0}]),/编号/);
  assert.throws(()=>modelPlacement(source,[{number:'1',x:0,y:0},{number:'2',x:10,y:0}]),/无法对齐/);
});
test('KiCad reuse retains native pads but replaces old models with aligned downloaded STEP',()=>{
  const text='(footprint "Native" (pad "1" smd rect (at -0.8 0) (size 1 1) (layers "F.Cu")) (pad "2" smd rect (at 0.8 0) (size 1 1) (layers "F.Cu")) (model "old.wrl"))';
  const source=[['PAD',null,null,null,1,'1',-0.8/0.0254,0],['PAD',null,null,null,1,'2',0.8/0.0254,0]];
  const result=useKiCadFootprint(text,{name:'Part'},'New','D:/model.step',source);
  assert.equal(result.pads[0].width,1);assert.ok(result.text.includes('D:/model.step'));assert.ok(!result.text.includes('old.wrl'));assert.equal(result.placement.x,0);
});
test('SOP8 with matching pin pitch but closer rows is rejected instead of fitted within the old tolerance',()=>{
  const source=Array.from({length:8},(_,i)=>({number:String(i+1),x:i<4?-2.7:2.7,y:(i<4?i:7-i)*1.27}));
  const narrow=source.map(p=>({...p,x:p.x<0?-2.5:2.5}));
  // The previous centroid fit accepted each pin's 0.2 mm error (<0.25 mm).
  assert.throws(()=>modelPlacement(source,narrow),/排距或跨度不一致/);
  const translated=source.map(p=>({...p,x:p.x+20,y:p.y-10,width:2,drill:0.7}));
  assert.deepEqual(modelPlacement(source,translated),{x:20,y:-10,angle:0});
  const rotated=source.map(p=>({...p,x:-p.y+20,y:p.x-10}));
  const pose=modelPlacement(source,rotated);assert.equal(pose.angle,90);assert.ok(Math.abs(pose.x-20)<1e-8);assert.ok(Math.abs(pose.y+10)<1e-8);
});
test('small library manufacturing variations are allowed and invalid coordinates are rejected',()=>{
  const source=[{number:'1',x:-0.8,y:0},{number:'2',x:0.8,y:0}];
  assert.ok(modelPlacement(source,[{number:'1',x:-0.775,y:0},{number:'2',x:0.775,y:0}]));
  assert.throws(()=>modelPlacement(source,[{number:'1',x:NaN,y:0},{number:'2',x:1,y:0}]),/坐标无效/);
});
