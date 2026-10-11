const fs=require('node:fs/promises');
function alive(pid){try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
async function acquireLock(file){
 for(let attempt=0;attempt<2;attempt++){
  try{const handle=await fs.open(file,'wx');try{await handle.writeFile(JSON.stringify({schema:'hub-lock/v1',pid:process.pid,createdAt:new Date().toISOString()}));}catch(e){await handle.close();await fs.unlink(file).catch(()=>{});throw e;}return handle;}
  catch(e){if(e.code!=='EEXIST')throw e;
   const bytes=await fs.readFile(file,'utf8');let record;try{record=JSON.parse(bytes);}catch{}
   if(record?.schema!=='hub-lock/v1' || !Number.isInteger(record.pid) || record.pid<=0)throw new Error('发现旧版或无法识别的转换锁，请确认没有任务运行后移除：'+file);
   if(alive(record.pid))throw new Error('该库正在由另一个任务转换，请等待完成。');
   if(await fs.readFile(file,'utf8')!==bytes)throw new Error('转换锁已变化，请重试。');await fs.unlink(file);
  }
 }
 throw new Error('无法获取转换锁，请重试。');
}
module.exports={acquireLock,alive};
