const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {ExportLog}=require('../src/export-log.cjs');
test('batch log retains full events, per-part warnings and runtime errors across separate exports',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-log-test-'));
  try {
    const journal=new ExportLog('kicad',['C1','C2'],{kicadDir:root});
    for(let i=0;i<150;i++)journal.add('事件 '+i);
    journal.add('中文错误详情 '+ 'x'.repeat(6000));
    journal.finish(null,{successIds:['C1'],results:[{id:'C1',footprintSource:'easyeda',warnings:['本地封装回退立创']}]},{results:[{id:'C2',message:'未找到 3D 模型'}]});
    const file=await journal.save(root),bytes=await fs.readFile(file,'utf8');
    for(const value of ['事件 0','事件 149','x'.repeat(6000),'C2：未完成','未找到 3D 模型','本地封装回退立创','成功 1，未完成 1'])assert.ok(bytes.includes(value),value);
    assert.equal(bytes.charCodeAt(0),0xfeff);
    const next=new ExportLog('kicad',['C3'],{kicadDir:root});next.finish(new Error('工具不存在'));
    const nextFile=await next.save(root);assert.notEqual(nextFile,file);
    const nextBytes=await fs.readFile(nextFile,'utf8');assert.ok(nextBytes.includes('工具不存在'));assert.ok(!nextBytes.includes('事件 149'));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('unwritable library path falls back to application data logs',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-log-test-'));
  try {
    const blocked=path.join(root,'file');await fs.writeFile(blocked,'blocked');
    const journal=new ExportLog('cadence',['C1'],{cadenceDir:blocked});journal.finish(new Error('输出失败'));
    const file=await journal.save(root);assert.equal(path.dirname(file),path.join(root,'export_logs'));
    assert.ok((await fs.readFile(file,'utf8')).includes('日志使用备用目录'));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
