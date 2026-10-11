const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {preflight}=require('../src/preflight.cjs');
test('preflight reports independent errors together and allows all-existing exports offline',async t=>{
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'hub-preflight-'));t.after(()=>fs.rm(output,{recursive:true,force:true}));
  const deps={existingLibrary:async()=>new Map(),checkTools:async()=>{throw new Error('FreeCAD 缺失');},checkTarget:async()=>{throw new Error('CLI 缺失');}};
  const bad=await preflight('kicad',['C123'],{kicadDir:output},{connected:false,loggedIn:false},deps);assert.equal(bad.ok,false);assert.equal(bad.checks.filter(x=>!x.ok).length,4);assert.ok(bad.checks.find(x=>x.key==='output').ok);
  deps.existingLibrary=async()=>new Map([['C123',{complete:true}]]);const reuse=await preflight('kicad',['C123'],{kicadDir:output},{},deps);assert.equal(reuse.ok,true);assert.equal(reuse.allReused,true);
  assert.equal((await fs.readdir(output)).length,0);
});
