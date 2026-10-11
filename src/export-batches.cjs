function initialize(job){job.batches=[];for(let i=0;i<job.downloadIds.length;i+=50)job.batches.push(job.downloadIds.slice(i,i+50));job.batchIndex=-1;job.aggregateResults=[...job.reused];job.runtimeResults=[];job.processedCount=0;return job;}
function nextBatch(job){
 if(job.stopRequested || job.batchIndex+1>=job.batches.length)return null;
 job.batchIds=job.batches[++job.batchIndex];job.message=undefined;job.file=undefined;job.fileName=undefined;job.download=undefined;job.running=false;
 return job.batchIds;
}
function acceptBatch(job,result){job.aggregateResults.push(...result.results);job.runtimeResults.push(...(job.message?.results || []));job.processedCount+=job.batchIds.length;}
function summary(job){const results=job.aggregateResults || job.reused || [],successIds=[...new Set(results.filter(r=>r.status==='converted').map(r=>r.id))];return {results,successIds,converted:successIds.length,failed:job.ids.length-successIds.length};}
function batchProgress(job,phase,completed=0,total=job.batchIds?.length || 1){
 const offset=phase==='download'?0:phase==='extract'?0.35:0.6,span=phase==='download'?0.35:phase==='extract'?0.25:0.4;
 return 100*((job.reused?.length || 0)+(job.processedCount || 0)+(job.batchIds?.length || total)*(offset+span*Math.min(1,completed/Math.max(total,1))))/Math.max(job.ids.length,1);
}
module.exports={initialize,nextBatch,acceptBatch,summary,batchProgress};
