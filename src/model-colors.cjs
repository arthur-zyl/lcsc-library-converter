const fs=require('node:fs/promises'),path=require('node:path');
const {spawn}=require('node:child_process');
async function restoreModelColors(part,settings,log=()=>{}) {
  const reportFile=path.join(part.folder,part.id+'_report.json');
  let prior;try{prior=JSON.parse(await fs.readFile(reportFile,'utf8'));}catch{}
  if(prior?.outputs?.mount_z0?.face_colors_checked)return;
  const source=path.join(part.folder,'pcb_with_component.step');
  try{await fs.access(source);}catch{return;}
  if(!settings.freecadPython)throw new Error('旧模型需恢复颜色，请先设置 FreeCAD Python');
  log(`${part.id}：从原始 PCB STEP 恢复模型颜色`);
  const scratch=await fs.mkdtemp(path.join(part.folder,'.color-'));
  try {
    const translation=prior?.mount_translation_mm || [0,0,0];
    if(!translation.slice(0,2).every(Number.isFinite))throw new Error('旧模型的坐标记录无效');
    await new Promise((resolve,reject)=>{
      const child=spawn(settings.freecadPython,[path.join(__dirname,'../tools/extract_easyeda_step.py'),source,'--out-dir',scratch,'--part-id',part.id,'--footprint-x',String(-translation[0]),'--footprint-y',String(-translation[1])],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
      let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('FreeCAD 颜色恢复超时'));},180000);
      for(const stream of [child.stdout,child.stderr])stream.on('data',x=>{output=(output+x.toString('utf8')).slice(-12000);});
      child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('FreeCAD 颜色恢复失败：'+output));});
    });
    const next=JSON.parse(await fs.readFile(path.join(scratch,part.id+'_report.json'),'utf8'));
    if(!next.outputs.mount_z0.face_colors_checked)throw new Error('模型颜色未通过重新导入校验');
    for(const suffix of ['_board_coordinates.step','_mount_z0.step'])await fs.copyFile(path.join(scratch,part.id+suffix),path.join(part.folder,part.id+suffix));
    next.outputs.board_coordinates.file=path.join(part.folder,part.id+'_board_coordinates.step');next.outputs.mount_z0.file=part.model;
    await fs.writeFile(reportFile,JSON.stringify(next,null,2));
  } finally {
    if(path.dirname(scratch)===part.folder && path.basename(scratch).startsWith('.color-'))await fs.rm(scratch,{recursive:true,force:true}).catch(()=>{});
  }
}
module.exports={restoreModelColors};
