const path=require('node:path');
const {validTemp,preserveArtifacts}=require('./failed-artifacts.cjs');
async function recover(store){
 const job=store.state.activeExport;if(!job)return false;
 if(!['kicad','cadence','altium'].includes(job.target) || !Array.isArray(job.items))throw new Error('恢复记录无效，请检查配置文件。');
 for(const item of job.items)if(/^C[1-9]\d*$/.test(item.id) && !store.state.queue.some(x=>x.id===item.id))store.state.queue.push(item);
 const values={...store.state.exportItemResults?.[job.target]};
 for(const item of job.items)if(values[item.id]?.status!=='converted')values[item.id]={status:'interrupted',label:'中断',message:'上次任务异常退出；重试会先检查并复用已完成的库。',updatedAt:new Date().toISOString()};
 store.state.exportItemResults={...store.state.exportItemResults,[job.target]:values};
 store.state.recovery={target:job.target,ids:job.items.map(x=>x.id),startedAt:job.startedAt};
 if(validTemp(job.root)){
   const diagnosticPath=await preserveArtifacts(job.root,path.join(store.root,'failed-exports'),{target:job.target,reason:'异常退出',requestedIds:job.items.map(x=>x.id)});
   if(diagnosticPath)store.state.recovery.diagnosticPath=diagnosticPath;
 }
 delete store.state.activeExport;await store.persist();return true;
}
async function checkpoint(store,job){
 store.state.activeExport={target:job.target,root:job.root,startedAt:job.startedAt || new Date().toISOString(),items:store.state.queue.filter(x=>job.ids.includes(x.id))};
 await store.persist();
}
module.exports={recover,checkpoint,validTemp};
