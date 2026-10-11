const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {restoreModelColors}=require('../src/model-colors.cjs');
test('C2915308 trimmed curved STEP uses tight geometry bounds and preserves mounting/colors',{skip:!process.env.HUB_FREECAD_PYTHON,timeout:60000},async t=>{
 const {execFileSync}=require('node:child_process');const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-curved-step-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 execFileSync(process.env.HUB_FREECAD_PYTHON,[path.join(__dirname,'../tools/extract_easyeda_step.py'),path.join(__dirname,'fixtures/step/C2915308/pcb_with_component.step'),'--part-id','C2915308','--out-dir',root],{windowsHide:true,encoding:'utf8'});
 const report=JSON.parse(await fs.readFile(path.join(root,'C2915308_report.json'),'utf8'));
 for(const output of Object.values(report.outputs)){assert.ok(output.bounds_comparison.max_delta_mm<1e-9);assert.equal(output.face_colors_checked,true);assert.equal(output.solids,1);assert.equal(output.colored_faces,318);assert.equal(output.unique_colors,2);}
 assert.ok(Math.abs(report.outputs.mount_z0.bounds_mm.ZMin)<0.00001);assert.ok(Math.abs(report.outputs.mount_z0.bounds_mm.ZLength-5.9103818)<0.00001);
});
test('STEP flattening preserves nested 0/90/180/-90 rotations without double application',{skip:!process.env.HUB_FREECAD_PYTHON},async t=>{
 const {execFileSync}=require('node:child_process');const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-nested-rotation-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const script=`import sys\nsys.path.insert(0,${JSON.stringify(path.join(__dirname,'../tools'))})\nimport FreeCAD as A,Part,Import\nfrom extract_easyeda_step import colored_component,world_shape\nfrom pathlib import Path\nfor angle in [0,90,180,-90]:\n d=A.newDocument('Source');parent=d.addObject('App::Part','Parent');parent.Placement=A.Placement(A.Vector(3,-4,2),A.Rotation(A.Vector(0,0,1),30));child=d.addObject('App::Part','Child');parent.addObject(child);child.Placement=A.Placement(A.Vector(1,2,0),A.Rotation(A.Vector(0,0,1),angle));o=d.addObject('Part::Feature','Body');child.addObject(o);o.Shape=Part.makeBox(3,1,2,A.Vector(2,0,0));o.Placement=A.Placement(A.Vector(0.3,0.7,0),A.Rotation(A.Vector(0,0,1),17));d.recompute();shape,colors=colored_component(child,[(o,[(1,0,0)])]);expected=world_shape(child);assert shape.cut(expected).Volume+expected.cut(shape).Volume<1e-6\n out=A.newDocument('Out');feature=out.addObject('Part::Feature','Model');feature.Shape=shape;out.recompute();file=str(Path(${JSON.stringify(root)})/(str(angle)+'.step'));Import.export([(feature,colors)],file,legacy=False,keepPlacement=True);A.closeDocument(out.Name);check=A.newDocument('Check');Import.insert(file,check.Name);loaded=world_shape(next(x for x in check.Objects if hasattr(x,'Shape') and x.Shape.Solids and not any(p.TypeId=='App::Part' for p in x.InList)));assert expected.cut(loaded).Volume+loaded.cut(expected).Volume<1e-6;A.closeDocument(check.Name);A.closeDocument(d.Name)\n`;
 execFileSync(process.env.HUB_FREECAD_PYTHON,['-c',script],{windowsHide:true});
});
test('STEP bounds accept 0.005 mm noise but reject 0.02 mm shifts with measured deltas',{skip:!process.env.HUB_FREECAD_PYTHON},()=>{
 const {execFileSync}=require('node:child_process');
 const script="from step_bounds import compare_bounds\na={'XMin':0., 'XMax':10.}\nb={'XMin':0.005, 'XMax':10.005}\nr=compare_bounds(a,b)\nassert r['passed'] and r['max_delta_mm']>0.0049\nassert not compare_bounds(a,{'XMin':0.02,'XMax':10.02})['passed']\n";
 execFileSync(process.env.HUB_FREECAD_PYTHON,['-c',script],{cwd:path.join(__dirname,'../tools'),windowsHide:true});
});
test('existing white model is regenerated with per-face colors and unchanged mount geometry',{skip:!process.env.HUB_FREECAD_PYTHON},async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'hub-color-test-')),id='C5137636';
  const fixture=path.join(__dirname,'fixtures/kicad',id);
  await fs.copyFile(path.join(fixture,'pcb_with_component.step'),path.join(folder,'pcb_with_component.step'));
  await fs.copyFile(path.join(fixture,id+'_mount_z0.step'),path.join(folder,id+'_mount_z0.step'));
  await fs.writeFile(path.join(folder,id+'_report.json'),JSON.stringify({mount_translation_mm:[0,0,-1.600028244856]}));
  const part={id,folder,model:path.join(folder,id+'_mount_z0.step')};
  const old=await fs.readFile(part.model),original=await fs.readFile(path.join(folder,'pcb_with_component.step'));
  await restoreModelColors(part,{freecadPython:process.env.HUB_FREECAD_PYTHON});
  const report=JSON.parse(await fs.readFile(path.join(folder,id+'_report.json'),'utf8'));
  assert.equal(report.outputs.mount_z0.face_colors_checked,true);assert.equal(report.outputs.mount_z0.colored_faces,357);assert.equal(report.outputs.mount_z0.unique_colors,3);
  assert.ok(Math.abs(report.outputs.mount_z0.bounds_mm.ZMin)<1e-5);assert.ok(Math.abs(report.outputs.mount_z0.bounds_mm.ZLength-0.8)<1e-5);
  assert.notDeepEqual(await fs.readFile(part.model),old);assert.deepEqual(await fs.readFile(path.join(folder,'pcb_with_component.step')),original);
  const before=(await fs.stat(part.model)).mtimeMs;await restoreModelColors(part,{freecadPython:process.env.HUB_FREECAD_PYTHON});assert.equal((await fs.stat(part.model)).mtimeMs,before);
});
