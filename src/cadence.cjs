const {acquireLock}=require('./conversion-lock.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const {libraryIndex,matchFootprint}=require('./local-footprints.cjs');
const {reuseCadence}=require('./cadence-reuse.cjs');
const {readComponent}=require('./easyeda-library.cjs');
const {captureSymbol,libraryXml,applyPinNames}=require('./cadence-symbol.cjs');
const {footprint,buildScript,auditScript,checkAudit}=require('./cadence-footprint.cjs');
const {shapeCommands,checkShapeAudit}=require('./cadence-custom-pads.cjs');
const {restoreModelColors}=require('./model-colors.cjs');
const {libraryName,uniqueName}=require('./kicad-names.cjs');
const {existingLibrary}=require('./existing-library.cjs');
const {footprintKey}=require('./cadence-models.cjs');
const {modelInfo}=require('./model-info.cjs');
const tools=path.resolve(__dirname,'../tools');
async function detectCadence(bases=['C:/Cadence','D:/Cadence','E:/Cadence',path.join(process.env.ProgramFiles || 'C:/Program Files','Cadence'),path.join(process.env.LOCALAPPDATA || 'C:/Users/Default/AppData/Local','Programs/Cadence')]){
  const candidates=[];
  for(const base of [...new Set(bases)]) {
    const names=await fs.readdir(base).catch(()=>[]);
    for(const name of names.filter(n=>/^SPB_/i.test(n)))candidates.push({root:path.join(base,name),version:name});
    candidates.push({root:base,version:'0'});
  }
  for(const item of candidates.sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}))){
    const files=await Promise.all(['tclsh.exe','orDb_Dll_Tcl64.dll','allegro.exe'].map(file=>fs.stat(path.join(item.root,'tools/bin',file)).catch(()=>null)));
    if(files.every(x=>x?.isFile()))return item.root;
  }return '';
}
function run(executable,args,cwd,root){return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{cwd,windowsHide:true,env:{...process.env,PATH:path.join(root,'tools/bin')+path.delimiter+process.env.PATH,PYTHONUTF8:'1'}});let output='',timeout=false;
  const timer=setTimeout(()=>{timeout=true;child.kill();},180000);
  const collect=x=>{output=(output+x.toString('utf8')).slice(-30000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(timeout)reject(new Error('Cadence 转换超过 3 分钟，已停止本次原生进程。'));else if(code!==0)reject(new Error(output.slice(-4000)||'原生转换器失败 '+code));else resolve(output);});
});}
async function captureNative(entries,library,work,settings,root){
  const input=path.join(work,'library.xml'),olb=path.join(work,library+'.olb'),roundtrip=path.join(work,'roundtrip.xml'),expected=path.join(work,'expected.json');
  await fs.writeFile(input,libraryXml(library,entries));await fs.writeFile(expected,JSON.stringify(entries));
  const check=(mode,file,reference)=>run(settings.freecadPython,[path.join(tools,'capture_check.py'),mode,file,reference],work,root);
  await check('schema',input,path.join(root,'tools/capture/tclscripts/capDB/olb.xsd'));
  await run(path.join(root,'tools/bin/tclsh.exe'),[path.join(tools,'capture_convert.tcl'),path.join(root,'tools/bin/orDb_Dll_Tcl64.dll'),input,olb,roundtrip],work,root);
  await check('roundtrip',roundtrip,expected);return {olb,input,roundtrip};
}
async function allegroNative(part,entry,work,root,modelName=entry+'.step'){
  const fp=footprint(part,entry,modelName);await fs.copyFile(part.model,path.join(work,modelName));
  const executable=path.join(root,'tools/bin/allegro.exe');
  for(const shape of fp.shapes){
    const name=shape.name,ilFile=path.join(work,name+'.il'),script=path.join(work,name+'.scr');
    await fs.writeFile(ilFile,buildScript(shapeCommands(shape)).replace('"build.ok"',JSON.stringify(name+'.ok')));
    await fs.writeFile(script,'skill load('+JSON.stringify(ilFile.replaceAll('\\','/'))+')\n');
    const output=await run(executable,['-nograph','-safe','-symbol','shape','-s',script,name+'.dra'],work,root);
    try{await fs.access(path.join(work,name+'.ok'));await fs.access(path.join(work,name+'.ssm'));}catch{throw new Error('Allegro 自定义焊盘生成失败：'+output.slice(-3000));}
  }
  for(const [name,il] of [['build',buildScript(fp.commands)],['audit',auditScript(fp.pads,modelName,fp.fills)]]) {
    const ilFile=path.join(work,name+'.il'),script=path.join(work,name+'.scr');await fs.writeFile(ilFile,il);await fs.writeFile(script,'skill load('+JSON.stringify(ilFile.replaceAll('\\','/'))+')\n');
    const output=await run(executable,['-nograph','-safe','-symbol','package','-s',script,entry+'.dra'],work,root);
    try{await fs.access(path.join(work,name+'.ok'));}catch{throw new Error('Allegro '+name+' 未完成。'+output.slice(-3000));}
  }
  await checkAudit(await fs.readFile(path.join(work,'audit.tsv'),'utf8'),fp.pads,modelName);
  checkShapeAudit(await fs.readFile(path.join(work,'shape-audit.tsv'),'utf8'),fp.pads);
  for(const ext of ['dra','psm']){const s=await fs.stat(path.join(work,entry+'.'+ext));if(s.size<100)throw new Error('原生封装为空');}
  return {...fp,modelName,files:[entry+'.dra',entry+'.psm',modelName,...fp.padNames.map(n=>n+'.pad'),...fp.shapes.map(s=>s.name+'.ssm')],work};
}
// Replace only managed files; roll back every replaced file if one rename fails.
async function commitFiles(output,files,owned){
  const backup=await fs.mkdtemp(path.join(output,'.commit-')),done=[];
  try {
    for(const [name,bytes] of files) {
      const dest=path.join(output,name);let prior;try{prior=await fs.readFile(dest);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(prior&&!owned.has(name)&&!prior.equals(bytes))throw new Error('目录内已有非本软件管理的同名文件：'+name);
      if(prior)await fs.writeFile(path.join(backup,name),prior);
      const temp=path.join(backup,name+'.new');await fs.writeFile(temp,bytes);await fs.rename(temp,dest);done.push({name,had:!!prior});
    }
  } catch(error){for(const item of done.reverse()){const dest=path.join(output,item.name);if(item.had)await fs.copyFile(path.join(backup,item.name),dest);else await fs.unlink(dest).catch(()=>{});}throw error;}
  finally{await fs.rm(backup,{recursive:true,force:true});}
}
async function convertCadenceLibrary(resources,settings,log=()=>{},control={}) {
  const root=settings.cadenceRoot,output=settings.cadenceDir,library=libraryName(settings.cadenceLibraryName||'LCSC');
  if(!root||!path.isAbsolute(root))throw new Error('请先在 Cadence 设置中选择 SPB 安装目录。');
  if(!output||!path.isAbsolute(output))throw new Error('请先设置 Cadence 库导出目录。');
  for(const file of ['tools/bin/tclsh.exe','tools/bin/orDb_Dll_Tcl64.dll','tools/bin/allegro.exe','tools/capture/tclscripts/capDB/olb.xsd'])await fs.access(path.join(root,file)).catch(()=>{throw new Error('Cadence 安装目录缺少 '+file);});
  await fs.mkdir(output,{recursive:true});let lock;const lockFile=path.join(output,'.cadence-conversion.lock');
  lock=await acquireLock(lockFile);
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'hub-cadence-'));
  try {
    let state={schema:'eda-component-hub/cadence-v1',library,entries:[],files:[]};
    try{state=JSON.parse(await fs.readFile(path.join(output,'hub_cadence.json'),'utf8'));if(state.schema!=='eda-component-hub/cadence-v1'||!Array.isArray(state.entries)||!Array.isArray(state.files))throw new Error('Cadence 管理索引无效，拒绝覆盖。');}catch(e){if(e.code!=='ENOENT')throw e;}
    const originalXml=new Map(state.entries.map(e=>[e.id,e.xml]));
    // Upgrade managed symbols as the cumulative library is rebuilt.
    for(const entry of state.entries)entry.xml=entry.xml.replace(/fillStyle="[0-9]+"/g,'fillStyle="1"').replace(/<IsPinNamesRotated>\s*<Defn\s+val="[01]"\s*\/>\s*<\/IsPinNamesRotated>/g,'<IsPinNamesRotated><Defn val="1"/></IsPinNamesRotated>');
    state.entries=state.entries.map(e=>applyPinNames(e));
    const symbolsChanged=state.entries.some(e=>e.xml!==originalXml.get(e.id));
    for(const e of state.entries)for(const warning of e.warnings||[])if(warning.startsWith('引脚名称/类型更新'))log(`${e.id}：${warning}`);
    const entries=new Map(state.entries.map(e=>[e.id,e])),symbols=new Map(state.entries.map(e=>[e.entry,e.id])),footprints=new Map(state.entries.map(e=>[e.footprintEntry,e.id])),pending=[],results=[];
    for(const name of await fs.readdir(output)){if(name.endsWith('.psm')&&!footprints.has(name.slice(0,-4)))footprints.set(name.slice(0,-4),'unmanaged');}
    let localIndex=[];try{localIndex=await libraryIndex('cadence',settings);}catch(e){log('本地封装库不可用，回退立创：'+e.message);}
    const unique=[...new Map(resources.map(r=>[r.id,r])).values()];
    const previous=await existingLibrary('cadence',unique.map(r=>r.id),settings);
    for(const [index,r] of unique.entries()) {
      if(control.isStopped?.())break;
      control.onProgress?.({currentId:r.id,completed:index,total:unique.length});
      log(`Cadence ${index+1}/${unique.length}：${r.id}，转换符号和封装`);
      try {
        const prior=previous.get(r.id);
        if(prior?.complete){log(`${r.id}：原理图库、封装和模型已存在，跳过转换`);results.push({id:r.id,status:'converted',reused:true,reusedSymbol:true,reusedFootprint:true,entry:prior.entry,footprintEntry:prior.footprintEntry,warnings:['已存在，跳过转换。']});continue;}
        const part=await readComponent(r.folder);if(part.id!==r.id)throw new Error('资源编号不一致');
        const incomingModel=modelInfo(part.manifest);
        const matched=matchFootprint(part.footprintTitle,localIndex);
        const key=prior?.record.footprintKey || footprintKey(part,matched);
        const shared=prior?null:[...entries.values()].find(e=>e.footprintKey===key);
        const sharedPending=shared && pending.find(p=>p.record.id===shared.id);
        const sharedInfo=shared && !sharedPending?(await existingLibrary('cadence',[shared.id],settings)).get(shared.id):null;
        const shareable=sharedPending || (sharedInfo?.footprintExists && sharedInfo.modelExists);
        const entry=prior?.entry || uniqueName(part.name,part.id,symbols,part.properties.Manufacturer||part.id),footprintEntry=prior?.footprintEntry || (shareable?shared.footprintEntry:uniqueName(part.footprintTitle.replace(/[^A-Za-z0-9_-]/g,'_'),part.id,footprints,part.name.replace(/[^A-Za-z0-9_-]/g,'_')));
        // The first model is the DRA's default. Preserve its relative filename
        // for libraries exported before device-level mapping was removed.
        const owner=[...entries.values()].find(e=>e.footprintEntry===footprintEntry);
        const staged=pending.findLast(p=>p.record.footprintEntry===footprintEntry);
        const modelName=owner?.modelName || footprintEntry+'.step';
        const modelFile=path.join(output,modelName);
        const existingModel=staged?.model.bytes || await fs.readFile(modelFile).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
        const previousSource=staged?.record.modelSource || owner?.modelSource || {kind:'real',placeholder:false};
        const replaceModel=!!existingModel && previousSource.placeholder===true && !incomingModel.placeholder;
        let selectedSource=incomingModel;
        if(existingModel && !replaceModel){selectedSource=previousSource;part.model=staged?staged.part.model:modelFile;}
        else await restoreModelColors(part,settings,log);
        const model={modelName,bytes:existingModel && !replaceModel?existingModel:await fs.readFile(part.model),replace:replaceModel};
        log(`${r.id}：${replaceModel?'真实模型替换高度占位模型':selectedSource.placeholder?'使用高度占位模型（可由真实模型替换）':'使用封装共用模型'} ${modelName}`);
        const symbol=prior?.symbolExists?entries.get(r.id):captureSymbol(part,entry,footprintEntry),work=path.join(scratch,part.id);await fs.mkdir(work);
        let fp,reuseWarning;
        const existingDra=prior && await fs.stat(path.join(output,footprintEntry+'.dra')).catch(e=>{if(e.code==='ENOENT')return false;throw e;});
        if(prior?.footprintExists){fp={...prior.record,placement:prior.record.modelPlacement,work:output,files:prior.record.files,warnings:[...prior.record.warnings]};log(`${r.id}：封装已存在，跳过封装转换`);}
        else if(shareable){fp={...shared,placement:shared.modelPlacement,work:sharedPending?.fp.work || output,files:shared.files.filter(f=>!f.endsWith('.step')),warnings:[...shared.warnings]};log(`${r.id}：复用相同封装 ${footprintEntry}，器件模型 ${model.modelName}`);}
        else if(matched && !existingDra){try{fp=await reuseCadence(part,footprintEntry,work,root,matched,run,model.modelName);log('使用 Cadence 本地封装：'+matched.name);}catch(e){reuseWarning='本地封装回退立创：'+e.message;log(reuseWarning);if(path.dirname(path.resolve(work))!==path.resolve(scratch) || path.basename(work)!==part.id)throw new Error('临时目录校验失败');await fs.rm(work,{recursive:true,force:true});await fs.mkdir(work);}}
        else if(settings.cadenceFootprintSource==='eda' && !existingDra)reuseWarning='未找到唯一的本地封装，使用立创封装。';
        if(!fp && existingDra) {
          // Recover PSM/PAD from the existing DRA's embedded definitions, preserving its geometry.
          await fs.copyFile(path.join(output,footprintEntry+'.dra'),path.join(work,footprintEntry+'.dra'));
          await fs.copyFile(part.model,path.join(work,model.modelName));
          // Shape dependencies are external even though the DRA embeds pad definitions.
          for(const name of (prior.record.files||[]).filter(f=>f.endsWith('.ssm'))){
            if(path.basename(name)!==name)throw new Error('自定义形状文件名无效');
            try{await fs.copyFile(path.join(output,name),path.join(work,name));}
            catch(error){
              if(error.code!=='ENOENT')throw error;
              const stored=prior.record.pads?.find(p=>p.shapeName+'.ssm'===name&&p.points);
              const shape=stored?{name:stored.shapeName,points:stored.points}:footprint(part,footprintEntry,model.modelName).shapes.find(s=>s.name+'.ssm'===name);
              if(!shape)throw new Error('缺失的自定义焊盘形状无法从当前立创源码恢复：'+name);
              const il=path.join(work,shape.name+'.il'),scr=path.join(work,shape.name+'.scr');
              await fs.writeFile(il,buildScript(shapeCommands(shape)).replace('"build.ok"',JSON.stringify(shape.name+'.ok')));
              await fs.writeFile(scr,'skill load('+JSON.stringify(il.replaceAll('\\','/'))+')\n');
              await run(path.join(root,'tools/bin/allegro.exe'),['-nograph','-safe','-symbol','shape','-s',scr,shape.name+'.dra'],work,root);
              await fs.access(path.join(work,name));
            }
          }
          const script=path.join(work,'recover.scr'),il=path.join(work,'recover.il');
          await fs.writeFile(il,buildScript(['axlDBChangeDesignUnits("millimeters" 4)','axlSetVariable("psmpath" list("."))',
            'foreach(p axlDBGetDesign()->pins unless(axlPadstackToDisk(p->definition->name) error("Padstack recovery failed")))',
            'unless(axlSaveDesign(?noMru t ?noConfirm t) error("Recovery save failed"))',
            'unless(axlCompileSymbol(?silent t ?silentOnOverwrite t) error("PSM recovery failed"))']));
          await fs.writeFile(script,'skill load('+JSON.stringify(il.replaceAll('\\','/'))+')\n');
          const nativeLog=await run(path.join(root,'tools/bin/allegro.exe'),['-nograph','-safe','-symbol','package','-s',script,footprintEntry+'.dra'],work,root);
          try{await fs.access(path.join(work,'build.ok'));}catch{throw new Error('已有封装修复失败：'+nativeLog);}
          const files=(await fs.readdir(work)).filter(f=>/\.(pad|ssm)$/.test(f) || f===footprintEntry+'.dra' || f===footprintEntry+'.psm' || f===model.modelName);
          fp={...prior.record,placement:prior.record.modelPlacement,work,files,warnings:[...prior.record.warnings,'复用已有 DRA，仅补充缺失的 PSM/PAD/SSM 文件。']};
          log(`${part.id}：保留已有 DRA，补充缺失的封装文件`);
        }
        if(!fp)fp=await allegroNative(part,footprintEntry,work,root,model.modelName);
        if(reuseWarning)fp.warnings.push(reuseWarning);
        const symbolNumbers=new Set(symbol.pins.map(p=>p.number)),padNumbers=new Set(fp.pads.filter(p=>p.number).map(p=>p.number));
        if(symbolNumbers.size!==padNumbers.size||[...symbolNumbers].some(p=>!padNumbers.has(p)))throw new Error('原始符号与封装引脚编号不一致：符号 ['+[...symbolNumbers].join(', ')+']；封装 ['+[...padNumbers].join(', ')+']。请在立创 EDA 修正引脚与焊盘的绑定后重试。');
        const record={id:part.id,entry,footprintEntry,...symbol,mpn:part.name,footprintKey:key,modelName:model.modelName,modelSource:selectedSource,modelPlacement:fp.placement || {x:0,y:0,angle:0},footprintSource:fp.footprintSource || 'easyeda',sourceFootprint:fp.sourceFootprint,warnings:[...new Set([...symbol.warnings,...fp.warnings,...(selectedSource.placeholder?['3D 模型为按器件高度生成的占位模型；再次导出时允许真实模型替换。']:[])])],files:[...new Set([...fp.files.filter(f=>!f.endsWith('.step')),model.modelName])],pads:fp.pads};
        if(!prior?.symbolExists)await captureNative([record],library,work,settings,root);else log(`${r.id}：原理图库已存在，跳过符号转换`);
        pending.push({part,record,fp,prior,model});entries.set(part.id,record);symbols.set(entry,part.id);footprints.set(footprintEntry,part.id);
        // All components using this footprint must see the same model status.
        for(const other of entries.values())if(other.footprintEntry===footprintEntry){other.modelName=modelName;other.modelSource=selectedSource;if(!selectedSource.placeholder)other.warnings=other.warnings.filter(w=>!w.startsWith('3D 模型为按器件高度生成的占位模型'));}
        results.push({id:part.id,status:'converted',reusedSymbol:!!prior?.symbolExists,reusedFootprint:!!prior?.footprintExists||!!shareable,modelReplaced:replaceModel,modelSource:selectedSource,modelName:model.modelName,entry,footprintEntry,footprintSource:record.footprintSource,sourceFootprint:record.sourceFootprint,pins:symbol.pins.length,pads:fp.pads.length,warnings:record.warnings});
      }catch(e){log(`${r.id} Cadence 转换失败：${e.message}`);results.push({id:r.id,status:'failed',message:e.message});} finally {control.onProgress?.({currentId:r.id,completed:index+1,total:unique.length});}
    }
    if(pending.length || symbolsChanged) {
      const files=new Map();
      for(const item of pending) {
        if(!item.prior?.footprintExists)for(const file of item.fp.files.filter(f=>!f.endsWith('.step'))) {
          // Never replace an existing per-component footprint, padstack or STEP.
          try{await fs.access(path.join(output,file));}catch(e){if(e.code!=='ENOENT')throw e;files.set(file,await fs.readFile(path.join(item.fp.work,file)));}
        }
        if(item.model.replace || !await fs.stat(path.join(output,item.record.modelName)).catch(e=>{if(e.code==='ENOENT')return false;throw e;}))files.set(item.record.modelName,item.model.bytes);
        files.set(item.record.modelName+'.json',Buffer.from(JSON.stringify({modelName:item.record.modelName,...item.record.modelSource},null,2)));
      }
      if(symbolsChanged || pending.some(item=>!item.prior?.symbolExists)) {
        log('Cadence：回读验证合并后的 OLB 库');const merged=path.join(scratch,'merged');await fs.mkdir(merged);const native=await captureNative([...entries.values()],library,merged,settings,root);
        files.set(library+'.olb',await fs.readFile(native.olb));
      }
      const retired=state.files.filter(name=>path.basename(name)===name&&['apply_step_models.il',state.library+'.xml',state.library+'_roundtrip.xml',state.library+'_review.dsn',state.library+'_placed_pins.tsv'].includes(name));
      const next={schema:state.schema,library,entries:[...entries.values()],files:[...new Set([...state.files.filter(name=>!retired.includes(name)),...files.keys(),'hub_cadence.json','使用说明.md','conversion_report.json'])]};
      files.set('hub_cadence.json',Buffer.from(JSON.stringify(next,null,2)));
      files.set('使用说明.md',Buffer.from(`# Cadence 元件库\n\n在 OrCAD Capture 的 Place Part → Add Library 中添加 ${library}.olb。PCB Footprint 已绑定同目录中的原生封装名称。\n\n在 Allegro User Preferences → Paths → Library 中，将本目录加入 psmpath、padpath 和 steppath。每个封装绑定一个共用 STEP，无需运行模型映射指令。模型只保存相对文件名，库移动后调整搜索路径即可。自定义焊盘依赖同目录的 .ssm 形状符号，请随 .pad 和封装文件一起保留。\n\n模型来源保存在 hub_cadence.json 的 modelSource 和 STEP 同名 .json 文件中。placeholder=true / kind=height_placeholder 表示按高度生成的占位模型。再次将器件加入导出清单后，会重新检查立创模型；有真实模型时，只替换占位 STEP，保留已有原理图库、封装及模型关联。不使用占位模型覆盖已有真实模型。\n\n后续元件累计加入同一 OLB。已有完整真实模型的元件会跳过转换；缺失文件补齐。焊盘、引脚和模型绑定经过原生回读检查；其他限制见 conversion_report.json。\n`));
      await commitFiles(output,files,new Set(state.files));
      for(const name of retired)await fs.unlink(path.join(output,name)).catch(e=>{if(e.code!=='ENOENT')log('旧辅助文件暂未移除：'+name);});
      for(const {part,record} of pending) {
        const file=path.join(part.folder,'component.json');let meta;try{meta=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;meta={id:part.id};}
        meta.conversions={...meta.conversions,cadence:{status:'converted',folder:output,library,entry:record.entry,footprintEntry:record.footprintEntry,convertedAt:new Date().toISOString(),warnings:record.warnings}};await fs.writeFile(file,JSON.stringify(meta,null,2));
      }
    }
    for(const result of results){const record=entries.get(result.id);if(result.status==='converted' && record?.modelSource){result.modelSource=record.modelSource;result.modelName=record.modelName;result.warnings=record.warnings;}}
    const report={provider:'cadence',library,folder:output,symbolsUpdated:symbolsChanged,managedSymbols:entries.size,converted:results.filter(r=>r.status==='converted').length,failed:results.filter(r=>r.status==='failed').length,results};
    await commitFiles(output,new Map([['conversion_report.json',Buffer.from(JSON.stringify(report,null,2))]]),new Set(state.files));return report;
  }finally{await lock.close();await fs.unlink(lockFile).catch(()=>{});await fs.rm(scratch,{recursive:true,force:true});}
}
module.exports={detectCadence,convertCadenceLibrary,captureNative,allegroNative,commitFiles};
