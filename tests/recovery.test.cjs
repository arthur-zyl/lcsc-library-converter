const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),{recover,checkpoint}=require('../src/recovery.cjs'),{acquireLock}=require('../src/conversion-lock.cjs');
test('restart restores interrupted queue and archives owned temporary inputs',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-recovery-test-')),temp=await fs.mkdtemp(path.join(os.tmpdir(),'eda-hub-export-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=await new Store(root).init();await store.add({id:'C1'});await checkpoint(store,{target:'kicad',ids:['C1'],root:temp});
 await fs.writeFile(path.join(temp,'original.zip'),'original');
 const next=await new Store(root).init();assert.equal(await recover(next),true);assert.equal(next.state.queue[0].id,'C1');assert.equal(next.state.exportItemResults.kicad.C1.status,'interrupted');await assert.rejects(fs.access(temp));assert.equal(await fs.readFile(path.join(next.state.recovery.diagnosticPath,'original.zip'),'utf8'),'original');assert.equal(await recover(next),false);
 next.state.activeExport={target:'kicad',items:[],root};await recover(next);await fs.access(root);
});
test('locks recover dead owners but reject live owners and unknown legacy locks',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-lock-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'lock');
 const lock=await acquireLock(file);await assert.rejects(acquireLock(file),/另一个任务/);await lock.close();await fs.unlink(file);
 await fs.writeFile(file,JSON.stringify({schema:'hub-lock/v1',pid:2147483647}));const next=await acquireLock(file);await next.close();await fs.unlink(file);
 await fs.writeFile(file,'');await assert.rejects(acquireLock(file),/旧版/);assert.equal(await fs.readFile(file,'utf8'),'');
});
