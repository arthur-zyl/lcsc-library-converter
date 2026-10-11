const test=require('node:test'),assert=require('node:assert/strict');
const {itemResults,exportSelection}=require('../src/export-results.cjs');
test('results keep conversion errors and runtime failures per component',()=>{
 const values=itemResults({ids:['C1','C2','C3'],message:{results:[{partId:'C3',message:'missing model'}]}},{results:[{id:'C1',status:'converted',reused:true},{id:'C2',status:'failed',message:'pad size'}]});
 assert.equal(values.C1.status,'converted');assert.equal(values.C2.message,'pad size');assert.equal(values.C3.message,'missing model');
});
test('single retries validate membership without changing the queue',()=>{
 const state={queue:[{id:'C1'},{id:'C2'}],exportTarget:'cadence'};
 assert.deepEqual(exportSelection({ids:['C2']},state),{target:'cadence',ids:['C2']});assert.equal(state.queue.length,2);assert.throws(()=>exportSelection({ids:['C3']},state));
});
