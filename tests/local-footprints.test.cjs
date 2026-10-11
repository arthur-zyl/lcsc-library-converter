const test=require('node:test'),assert=require('node:assert/strict');
const {key,matchFootprint,modelPlacement,useKiCadFootprint}=require('../src/local-footprints.cjs');
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
