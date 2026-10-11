const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {readComponent}=require('./easyeda-library.cjs'),{geometry}=require('./altium-geometry.cjs');
const {commitFiles}=require('./cadence.cjs'),{modelInfo}=require('./model-info.cjs'),{restoreModelColors}=require('./model-colors.cjs');
const {existingLibrary}=require('./existing-library.cjs'),{libraryName,uniqueName}=require('./kicad-names.cjs');
const {matchFootprint,modelPlacement}=require('./local-footprints.cjs');
const {createHash}=require('node:crypto');
const script=path.resolve(__dirname,'../tools/altium_convert.py');
function runPython(settings,args){return new Promise((resolve,reject)=>{
  const child=spawn(settings.freecadPython,[script,...args],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});let output='';
  const timer=setTimeout(()=>{child.kill();reject(new Error('AD 转换超过 3 分钟'));},180000);
  const append=x=>{output=(output+x.toString('utf8')).slice(-30000);};child.stdout.on('data',append);child.stderr.on('data',append);
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error(output.slice(-5000)||'AD 转换失败 '+code));});
});}
async function localIndex(settings,scratch,log){
  if(settings.altiumFootprintSource!=='eda')return [];
  if(!settings.altiumFootprintDir){log('未设置 AD 本地 PcbLib 目录，回退立创封装。');return [];}
  const files=[];async function walk(dir,depth){for(const item of await fs.readdir(dir,{withFileTypes:true})){if(item.isDirectory()&&depth<3)await walk(path.join(dir,item.name),depth+1);else if(item.isFile()&&/\.pcblib$/i.test(item.name))files.push(path.join(dir,item.name));}}
  await walk(settings.altiumFootprintDir,0);if(files.length>2000)throw new Error('AD 本地库文件过多，请选择更具体的目录');
  const output=path.join(scratch,'local_index.json'),input=path.join(scratch,'index_input.json');await fs.writeFile(input,JSON.stringify({files,output}));const info=await runPython(settings,['index',input]);if(info.trim())log(info.trim());return JSON.parse(await fs.readFile(output,'utf8'));
}
async function convertAltiumLibrary(resources,settings,log=()=>{}){
  const output=settings.altiumDir,library=libraryName(settings.altiumLibraryName||'LCSC');
  if(!output||!path.isAbsolute(output))throw new Error('请设置 AD 库导出目录');
  await fs.mkdir(output,{recursive:true});const lockFile=path.join(output,'.altium-conversion.lock');let lock;
  try{lock=await fs.open(lockFile,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('该 AD 库正在转换，请等待完成');throw e;}
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'hub-altium-'));
  try{
    await runPython(settings,['probe']);
    let state={schema:'eda-component-hub/altium-v1',library,entries:[],files:[]};
    try{state=JSON.parse(await fs.readFile(path.join(output,'hub_altium.json'),'utf8'));if(state.schema!=='eda-component-hub/altium-v1'||!Array.isArray(state.entries)||!Array.isArray(state.files))throw new Error('AD 管理索引无效，拒绝覆盖');}catch(e){if(e.code!=='ENOENT')throw e;}
    if(state.library!==library&&state.entries.length)throw new Error('该目录已有其他名称的 AD 库，请保持原库名称或选择新目录');
    const entries=new Map(state.entries.map(e=>[e.id,e])),symbols=new Map(state.entries.map(e=>[e.entry,e.id])),footprints=new Map(state.entries.map(e=>[e.footprintEntry,e.id]));
    let index=[];try{index=await localIndex(settings,scratch,log);}catch(e){log('AD 本地库读取失败，回退立创：'+e.message);}
    const results=[],unique=[...new Map(resources.map(r=>[r.id,r])).values()];
    for(const [i,r] of unique.entries()){
      log(`AD ${i+1}/${unique.length}：${r.id}，转换符号和封装`);
      try{
        const prior=(await existingLibrary('altium',[r.id],settings)).get(r.id);
        if(prior?.complete){results.push({id:r.id,status:'converted',reused:true,entry:prior.entry,footprintEntry:prior.footprintEntry,warnings:['已存在，跳过转换。']});continue;}
        const part=await readComponent(r.folder);if(part.id!==r.id)throw new Error('AD 资源编号不一致');
        const entry=prior?.entry||uniqueName(part.name,part.id,symbols,part.id);
        const fpKey=createHash('sha256').update(JSON.stringify(part.footprintRows)).digest('hex');
        const shared=[...entries.values()].find(e=>e.footprintKey===fpKey),footprintEntry=prior?.footprintEntry||shared?.footprintEntry||uniqueName(part.footprintTitle,part.id,footprints,part.name);
        const g=geometry(part,entry,footprintEntry);let local,placement=prior?.record.placement||shared?.placement||{x:0,y:0,angle:0},source=prior?.record.footprintSource||shared?.footprintSource||'easyeda';
        if(!prior?.footprintExists&&!shared&&settings.altiumFootprintSource==='eda'){
          const candidate=matchFootprint(part.footprintTitle,index);
          if(candidate){try{placement=modelPlacement(g.pads,candidate.pads);local=candidate;source='eda';log('使用 AD 本地封装：'+candidate.name);}catch(e){g.warnings.push('AD 本地封装回退立创：'+e.message);log(g.warnings.at(-1));}}
          else g.warnings.push('未找到唯一的 AD 本地封装，使用立创封装。');
        }
        const owner=[...entries.values()].find(e=>e.footprintEntry===footprintEntry),modelName=owner?.modelName||footprintEntry+'.step',modelFile=path.join(output,modelName);
        const existingBytes=await fs.readFile(modelFile).catch(e=>{if(e.code==='ENOENT')return null;throw e;}),incoming=modelInfo(part.manifest);
        const replace=!!existingBytes&&owner?.modelSource?.placeholder===true&&!incoming.placeholder;
        const selected=existingBytes&&!replace?(owner?.modelSource||{kind:'real',placeholder:false}):incoming;
        if(existingBytes&&!replace)part.model=modelFile;else await restoreModelColors(part,settings,log);
        if(selected.placeholder)g.warnings.push('3D 模型为高度占位模型，后续真实模型可以替换。');
        const work=path.join(scratch,r.id);await fs.mkdir(work);const audit=path.join(work,'audit.json');
        const schFile=path.join(output,library+'.SchLib'),pcbFile=path.join(output,library+'.PcbLib');
        const exists=async f=>!!await fs.stat(f).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
        const sourceSch=await exists(schFile)?schFile:null,sourcePcb=await exists(pcbFile)?pcbFile:null;
        const input={entry,footprintEntry,library,name:part.name,geometry:g,local,placement,model:part.model,modelName,updateModel:!sourcePcb||!prior?.footprintExists&&!shared||replace||!existingBytes,sourceSch,sourcePcb,output:work,audit};
        if(!sourceSch||!sourcePcb)input.recovery=state.entries.filter(e=>e.id!==r.id).map(e=>{
          if(!e.geometry)throw new Error('AD 索引缺少恢复数据，请重新导出原器件');
          if(path.basename(e.modelName)!==e.modelName)throw new Error('AD 模型恢复路径无效');
          return {...e,library,name:e.geometry.properties.MPN,model:e.footprintEntry===footprintEntry?part.model:path.join(output,e.modelName)};
        });
        const inputFile=path.join(work,'input.json');await fs.writeFile(inputFile,JSON.stringify(input));
        await runPython(settings,['convert',inputFile]);const verified=JSON.parse(await fs.readFile(audit,'utf8'));
        const record={id:r.id,entry,footprintEntry,footprintKey:fpKey,geometry:g,modelName,modelSource:selected,placement,footprintSource:source,local:local||owner?.local,sourceFootprint:local?.file||owner?.sourceFootprint,warnings:g.warnings};
        const nextEntries=new Map(entries);nextEntries.set(r.id,record);
        for(const [id,other] of nextEntries)if(other.footprintEntry===footprintEntry)nextEntries.set(id,{...other,modelName,modelSource:selected,warnings:selected.placeholder?other.warnings:other.warnings.filter(w=>!w.startsWith('3D 模型为高度占位'))});
        const files=new Map();
        if(!prior?.symbolExists)files.set(library+'.SchLib',await fs.readFile(path.join(work,library+'.SchLib')));
        if(input.updateModel||!prior?.footprintExists&&!shared)files.set(library+'.PcbLib',await fs.readFile(path.join(work,library+'.PcbLib')));
        if(!existingBytes||replace)files.set(modelName,await fs.readFile(part.model));
        files.set(modelName+'.json',Buffer.from(JSON.stringify({modelName,...selected},null,2)));
        const next={...state,entries:[...nextEntries.values()],files:[...new Set([...state.files,...files.keys(),'hub_altium.json','conversion_report.json','使用说明.md'])]};
        files.set('hub_altium.json',Buffer.from(JSON.stringify(next,null,2)));files.set('使用说明.md',Buffer.from(`在 Altium Designer 中安装 ${library}.SchLib 和 ${library}.PcbLib。原理图按型号命名并关联本库封装；多单元通过 Part A/B 等使用。STEP 已嵌入 PcbLib，移动库无需修改模型路径；同目录保留独立 STEP 和来源标记。placeholder=true 是高度占位模型，再次导出器件可由真实模型替换。已有符号和封装累计保留。\n`));
        // Shared commit routine requires parent directories to exist.
        await commitFiles(output,files,new Set(state.files));
        state=next;entries.clear();for(const e of state.entries)entries.set(e.id,e);symbols.set(entry,r.id);footprints.set(footprintEntry,r.id);
        log(`${r.id} AD 转换完成，${verified.pins} 引脚 / ${verified.pads} 焊盘；${replace?'真实模型替换占位模型':selected.placeholder?'高度占位模型':'STEP 已嵌入'}`);
        results.push({id:r.id,status:'converted',entry,footprintEntry,footprintSource:source,pins:verified.pins,pads:verified.pads,units:verified.units,modelSource:selected,modelReplaced:replace,warnings:g.warnings});
      }catch(e){log(`${r.id} AD 转换失败：${e.message}`);results.push({id:r.id,status:'failed',message:e.message});}
    }
    const report={provider:'altium',library,folder:output,converted:results.filter(r=>r.status==='converted').length,failed:results.filter(r=>r.status==='failed').length,results};
    const owned=new Set(state.files);state.files=[...new Set([...state.files,'hub_altium.json','conversion_report.json'])];
    await commitFiles(output,new Map([['conversion_report.json',Buffer.from(JSON.stringify(report,null,2))],['hub_altium.json',Buffer.from(JSON.stringify(state,null,2))]]),owned);return report;
  }finally{await lock.close();await fs.unlink(lockFile).catch(()=>{});await fs.rm(scratch,{recursive:true,force:true});}
}
module.exports={convertAltiumLibrary,runPython};
