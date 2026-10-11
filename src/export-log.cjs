const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
class ExportLog {
  constructor(target, ids, settings) {
    this.target=target;this.ids=[...ids];this.output=settings[target+'Dir'];this.entries=[];
    this.name=new Date().toISOString().replace(/[:.]/g,'-')+'_'+randomUUID().slice(0,8)+'.log';
    this.add(`开始导出：${target}\n器件：${ids.join(', ')}\n封装来源：${settings[target+'FootprintSource'] || 'easyeda'}\n输出目录：${this.output || '未设置'}\nFreeCAD：${settings.freecadPython || '未设置'}\n目标 EDA 工具：${settings[target==='altium'?'freecadPython':target==='cadence'?'cadenceRoot':'kicadCli'] || '未设置'}`);
  }
  add(message) { this.entries.push(`[${new Date().toISOString()}] ${String(message)}`); }
  finish(error, result, runtime) {
    if(runtime)this.add('立创 EDA 导出结果：\n'+JSON.stringify(runtime,null,2));
    const converted=new Set(result?.successIds || []);
    for(const id of this.ids) {
      const item=result?.results?.find(r=>r.id===id);
      this.add(`${id}：${converted.has(id)?item?.reused?'已有，跳过':'成功':'未完成'}${item?.reusedSymbol?'；复用原理图库':''}${item?.reusedFootprint?'；复用封装':''}${item?.message?'；'+item.message:''}${item?.footprintSource?'；封装来源 '+item.footprintSource:''}`);
      for(const warning of item?.warnings || [])this.add(`${id} 提示：${warning}`);
    }
    if(error)this.add('错误详情：\n'+(error.stack || error.message || error));
    this.add(`任务结束：成功 ${converted.size}，未完成 ${this.ids.length-converted.size}${runtime?.stoppedReason?'；中止原因：'+runtime.stoppedReason:''}`);
  }
  async save(fallbackRoot) {
    const bytes='\uFEFFEDA 元件导出日志\n'+this.entries.join('\n')+'\n';
    let primaryError;
    for(const root of [this.output,fallbackRoot]) {
      if(!root || !path.isAbsolute(root))continue;
      try {
        const folder=path.join(root,'export_logs');await fs.mkdir(folder,{recursive:true});
        const file=path.join(folder,this.name);
        await fs.writeFile(file,bytes+(primaryError?'\n日志使用备用目录：'+primaryError.message+'\n':''),{flag:'wx'});
        return file;
      }catch(error){primaryError=error;}
    }
    throw primaryError || new Error('没有可写的日志目录');
  }
}
module.exports={ExportLog};
