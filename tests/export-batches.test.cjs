const test=require('node:test'),assert=require('node:assert/strict');
const {initialize,nextBatch,acceptBatch,summary,batchProgress}=require('../src/export-batches.cjs');
test('121 items split 50/50/21 and aggregate successful results across failures',()=>{
 const ids=Array.from({length:121},(_,i)=>'C'+(i+1)),job=initialize({ids,downloadIds:ids,reused:[]});
 const sizes=[],progress=[];while(nextBatch(job)){sizes.push(job.batchIds.length);progress.push(batchProgress(job,'download'));job.message={results:job.batchIds.map(partId=>({partId,status:'complete'}))};acceptBatch(job,{results:job.batchIds.map(id=>({id,status:id==='C51'?'failed':'converted'}))});progress.push(batchProgress(job,'download'));}
 assert.deepEqual(sizes,[50,50,21]);assert.equal(summary(job).converted,120);assert.equal(summary(job).failed,1);assert.equal(job.runtimeResults.length,121);assert.ok(progress.every((v,i)=>!i || v>=progress[i-1]));
});
test('cancel prevents remaining batches and retains earlier successful libraries',()=>{
 const ids=Array.from({length:51},(_,i)=>'C'+(i+1)),job=initialize({ids,downloadIds:ids,reused:[]});nextBatch(job);acceptBatch(job,{results:job.batchIds.map(id=>({id,status:'converted'}))});job.stopRequested=true;
 assert.equal(nextBatch(job),null);assert.equal(summary(job).converted,50);assert.equal(summary(job).failed,1);
});
