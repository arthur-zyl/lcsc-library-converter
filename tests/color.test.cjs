const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {restoreModelColors}=require('../src/model-colors.cjs');
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
