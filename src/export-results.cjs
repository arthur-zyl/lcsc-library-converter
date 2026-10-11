function exportSelection(value,state){
  const target=(typeof value==='object'?value?.target:value) || state.exportTarget || 'kicad';
  const ids=typeof value==='object' && value?.ids ? value.ids : state.queue.map(x=>x.id);
  if(!Array.isArray(ids) || !ids.length || new Set(ids).size!==ids.length || ids.some(id=>!state.queue.some(x=>x.id===id)))throw new Error('重试元件已移出清单，请刷新后再试。');
  return {target,ids:[...ids]};
}
function itemResults(job,result,error){
  return Object.fromEntries(job.ids.map(id=>{
    const converted=result?.results?.find(r=>r.id===id),runtime=job.message?.results?.find(r=>r.partId===id);
    const success=converted?.status==='converted';
    const status=success?'converted':job.stopRequested || runtime?.status==='not_started'?'not_started':'failed';
    const message=success?(converted.reused?'已有完整库，已复用。':converted.warnings?.join('；') || '原理图、封装和模型已导出。'):converted?.message || error?.message || runtime?.message || '模型提取或转换未完成，请查看导出日志。';
    return [id,{status,label:success?'成功':status==='not_started'?'未完成':'失败',message,updatedAt:new Date().toISOString(),reused:!!converted?.reused,warnings:converted?.warnings || []}];
  }));
}
module.exports={itemResults,exportSelection};
