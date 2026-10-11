const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {checkTools,checkTarget}=require('./setup.cjs'),{existingLibrary}=require('./existing-library.cjs');
async function preflight(target,ids,settings,connection={},deps={}){
  const checks=[];const add=async(key,label,group,work)=>{try{const detail=await work();checks.push({key,label,group,ok:true,message:typeof detail==='string'?detail:'可用'});}catch(e){checks.push({key,label,group,ok:false,message:e.message});}};
  if(!['kicad','cadence','altium'].includes(target))return {ok:false,checks:[{label:'目标 EDA',ok:false,message:'请选择有效的目标 EDA。'}]};
  await add('queue','导出清单','queue',()=>{if(!ids?.length || ids.length>50 || new Set(ids).size!==ids.length || ids.some(id=>!/^C[1-9]\d*$/.test(id)))throw new Error('清单无效，每批最多 50 个。');return ids.length+' 个元件';});
  await add('output','库导出目录',target,async()=>{const dir=settings[target+'Dir'];if(!dir || !path.isAbsolute(dir))throw new Error('请填写完整的库导出目录。');const file=path.join(dir,'.hub-check-'+randomUUID());try{await fs.mkdir(dir,{recursive:true});await fs.writeFile(file,'',{flag:'wx'});}finally{await fs.unlink(file).catch(()=>{});}return dir;});
  let prior;await add('library','已有库检查',target,async()=>{prior=await (deps.existingLibrary || existingLibrary)(target,ids,settings);return '已有库索引可读取';});
  const allReused=!!ids?.length && ids.every(id=>prior?.get(id)?.complete);
  let info;if(!allReused){
    await add('freecad','FreeCAD','general',async()=>{const result=await (deps.checkTools || checkTools)({freecadPython:settings.freecadPython});info=result.info;return result.message;});
    await add('target',({kicad:'KiCad CLI',cadence:'Capture / Allegro',altium:'AD 转换依赖'}[target]),target,async()=>{await (deps.checkTarget || checkTarget)({...settings,target},info);return '必要工具可用'+(target==='cadence'?'；实际导出时还需可用许可证':'');});
    checks.push({key:'plugin',label:'立创 EDA 连接插件',group:'eda',ok:!!connection.connected,message:connection.connected?'已连接':'请导入连接插件并开启外部交互权限。'});
    checks.push({key:'login',label:'立创 EDA 登录',group:'eda',ok:connection.loggedIn===true,message:connection.loggedIn===true?'已登录':connection.loggedIn===false?'请先登录立创 EDA。':'登录状态尚未确认，请登录并连接插件。'});
  }else checks.push({key:'reuse',label:'已有完整元件库',ok:true,message:'全部可以复用，无需下载、连接或转换工具。'});
  return {ok:checks.every(x=>x.ok),checks,allReused,target};
}
module.exports={preflight};
