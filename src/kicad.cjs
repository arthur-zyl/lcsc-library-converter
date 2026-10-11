const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const JSZip=require('jszip');
const {readComponent}=require('./easyeda-library.cjs');
const {convertSymbol,quote}=require('./kicad-symbol.cjs');
const sx=require('./sexpr.cjs');
const {libraryIndex,matchFootprint,useKiCadFootprint}=require('./local-footprints.cjs');
const {existingLibrary}=require('./existing-library.cjs');
const {embedModel}=require('./kicad-model.cjs');
const {restoreModelColors}=require('./model-colors.cjs');
const {libraryName,uniqueName}=require('./kicad-names.cjs');
const {modelInfo}=require('./model-info.cjs');
async function atomicWrite(file,content) {
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(temporary,content);await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}
}
async function detectKiCad(bases=['C:/KiCad','D:/KiCad','E:/KiCad',path.join(process.env.ProgramFiles || 'C:/Program Files','KiCad'),path.join(process.env.LOCALAPPDATA || 'C:/Users/Default/AppData/Local','Programs/KiCad')]) {
  const candidates=[];
  for(const base of [...new Set(bases)]) {
    const entries=await fs.readdir(base).catch(()=>[]);
    for(const version of entries.filter(n=>/^\d+/.test(n) && parseInt(n,10)>=9))candidates.push({file:path.join(base,version,'bin','kicad-cli.exe'),version});
    candidates.push({file:path.join(base,'bin','kicad-cli.exe'),version:'0'});
  }
  for(const item of candidates.sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true})))if((await fs.stat(item.file).catch(()=>null))?.isFile())return item.file;
  return '';
}
function run(executable,args,config) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,env:{...process.env,KICAD_CONFIG_HOME:config}});let output='';let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},180000);
    const collect=chunk=>{output=(output+chunk.toString('utf8')).slice(-50000);};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);if(timedOut)reject(new Error('KiCad 转换超过 3 分钟，已停止。'));else if(code!==0)reject(new Error(output.trim()||`KiCad 返回错误 ${code}`));else resolve(output);});
  });
}
function normalizeFootprint(rows) {
  const warnings=[];const pads=rows.filter(x=>x[0]==='PAD');
  if(!pads.length)throw new Error('原始封装没有焊盘');
  for(const pad of pads) {
    if(![1,2,12].includes(pad[4]))throw new Error('原始焊盘图层无法识别');
    if([1,2].includes(pad[4]) && pad[9]) {
      const hole=pad[9];
      if(!['ROUND','RECT'].includes(hole[0]) || Number(hole[1])*0.0254>0.0011 || Number(hole[2]??hole[1])*0.0254>0.0011)throw new Error('单层焊盘带有真实尺寸孔，需核查原始封装');
      pad[9]=null; warnings.push('已移除单层贴片焊盘导出时的 1 微米占位孔。');
    }
    if(pad[4]===12 && !pad[9])throw new Error('多层焊盘缺少钻孔定义');
  }
  return {pads,warnings:[...new Set(warnings)]};
}
function patchFootprint(text,part,entry,model,pads) {
  const tree=sx.parse(text);if(sx.name(tree)!=='footprint')throw new Error('KiCad 未生成有效封装');tree[1]=sx.str(entry);
  for(let i=tree.length-1;i>=0;i--)if(['model','attr'].includes(sx.name(tree[i])))tree.splice(i,1);
  const targetPads=sx.children(tree,'pad');if(targetPads.length!==pads.length)throw new Error('转换前后焊盘数量不一致');
  const used=new Set(),converted=[];
  for(const source of pads) {
    const expected={x:Number(source[6])*0.0254,y:-Number(source[7])*0.0254};
    const target=targetPads.find((p,index)=>!used.has(index) && sx.value(p)===String(source[5]??'') && Math.abs(Number(sx.value(sx.child(p,'at')))-expected.x)<0.001 && Math.abs(Number(sx.value(sx.child(p,'at'),2))-expected.y)<0.001);
    if(!target)throw new Error(`焊盘 ${source[5]} 编号或坐标不一致`);used.add(targetPads.indexOf(target));
    const expectedType=source[4]===12 ? source[15] ? 'thru_hole' : 'np_thru_hole' : 'smd';
    if(sx.value(target,2)!==expectedType)throw new Error(`焊盘 ${source[5]} 类型不一致：需要 ${expectedType}`);
    const size=sx.child(target,'size'),shape=source[10];
    if(['ROUND','ELLIPSE','RECT','OVAL'].includes(shape?.[0])) {
      const w=Number(shape[1])*0.0254,h=Number(shape[2]??shape[1])*0.0254;
      if(Math.abs(Number(sx.value(size))-w)>0.001 || Math.abs(Number(sx.value(size,2))-h)>0.001)throw new Error(`焊盘 ${source[5]} 尺寸不一致`);
    }
    if(expectedType==='smd') {
      const layers=sx.child(target,'layers');const side=source[4]===1?'F':'B';
      if(!layers || !layers.slice(1).some(x=>x.value===side+'.Cu') || sx.child(target,'drill'))throw new Error(`贴片焊盘 ${source[5]} 图层或钻孔错误`);
    } else {
      const drill=sx.child(target,'drill');if(!drill)throw new Error(`焊盘 ${source[5]} 丢失钻孔`);
      const dimensions=drill.slice(1).filter(x=>!Array.isArray(x)&&Number.isFinite(Number(x.value))).map(x=>Number(x.value));
      const expectedDrill=[Number(source[9][1])*0.0254,Number(source[9][2]??source[9][1])*0.0254];
      if(!dimensions.length || Math.abs(dimensions[0]-expectedDrill[0])>0.001 || dimensions.length>1&&Math.abs(dimensions[1]-expectedDrill[1])>0.001)throw new Error(`焊盘 ${source[5]} 钻孔尺寸不一致`);
    }
    converted.push({number:sx.value(target),type:expectedType,x:Number(sx.value(sx.child(target,'at'))),y:Number(sx.value(sx.child(target,'at'),2)),width:Number(sx.value(size)),height:Number(sx.value(size,2))});
  }
  tree.push([sx.atom('attr'),sx.atom(pads.some(x=>x[4]===12)?'through_hole':'smd')]);
  tree.push(sx.parse(`(model ${quote(model.replaceAll('\\','/'))} (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))`));
  const value=sx.children(tree,'property').find(x=>sx.value(x)==='Value');if(value)value[2]=sx.str(part.name);
  return {text:sx.write(tree)+'\n',pads:converted};
}
async function convertLibrary(resources,settings,log=()=>{}) {
  const footprintLibrary=libraryName(settings.kicadFootprintLibraryName===undefined ? 'LCSC' : settings.kicadFootprintLibraryName);
  if(!resources.length)throw new Error('没有可转换的本地资源');
  if(!settings.kicadCli || !path.isAbsolute(settings.kicadCli))throw new Error('请先在设置中选择 KiCad 的 kicad-cli.exe');
  await fs.access(settings.kicadCli);
  const outputRoot=settings.kicadDir;if(!outputRoot || !path.isAbsolute(outputRoot))throw new Error('请在设置中选择 KiCad 库导出目录');
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'hub-kicad-'));const config=path.join(scratch,'config');await fs.mkdir(config);
  let output,lock;
  try {
    const version=(await run(settings.kicadCli,['version'],config)).trim();if(!/^(?:9|[1-9]\d)\./.test(version))throw new Error('KiCad 转换需要 KiCad 9 或更新版本。');
    const library='LCSC';output=outputRoot;await fs.mkdir(output,{recursive:true});
    const lockFile=path.join(output,'.conversion.lock');
    try{lock=await fs.open(lockFile,'wx');}catch(error){if(error.code==='EEXIST')throw new Error('该 KiCad 库已有转换任务；若软件异常退出，请删除 .conversion.lock 后重试。');throw error;}
    const pretty=path.join(output,footprintLibrary+'.pretty'),shapes=path.join(output,library+'.3dshapes');await fs.mkdir(pretty,{recursive:true});await fs.mkdir(shapes,{recursive:true});
    const symbolFile=path.join(output,library+'.kicad_sym');
    const symbols=new Map(),results=[],symbolOwners=new Map(),footprintOwners=new Map(),oldEntries=new Map(),obsoleteFootprints=new Set();
    const configFile=path.join(output,'library_settings.json');let priorLibrary='LCSC';
    try{priorLibrary=libraryName(JSON.parse(await fs.readFile(configFile,'utf8')).footprintLibrary);}catch(error){if(error.code!=='ENOENT')throw error;}
    let existing;try{existing=await fs.readFile(symbolFile,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    if(existing){const tree=sx.parse(existing);if(sx.name(tree)!=='kicad_symbol_lib' || sx.value(sx.child(tree,'generator'))!=='eda_component_hub')throw new Error('LCSC.kicad_sym 不是本软件生成的库，拒绝覆盖');
      for(const symbol of sx.children(tree,'symbol')){
        const props=sx.children(symbol,'property'),id=sx.value(props.find(p=>sx.value(p)==='LCSC'),2),binding=props.find(p=>sx.value(p)==='Footprint');
        const oldBinding=sx.value(binding,2)||'',separator=oldBinding.indexOf(':'),fpEntry=oldBinding.slice(separator+1);
        if(id){symbolOwners.set(sx.value(symbol),id);if(separator>=0){footprintOwners.set(fpEntry,id);oldEntries.set(id,{symbol:sx.value(symbol),footprint:fpEntry});}}
        if(binding && oldBinding.startsWith(priorLibrary+':'))binding[2]=sx.str(footprintLibrary+':'+fpEntry);
        symbols.set(sx.value(symbol),sx.write(symbol));
      }
    }
    // Copy the previous managed footprint library when its configured nickname changes.
    if(existing && priorLibrary!==footprintLibrary){const previous=path.join(output,priorLibrary+'.pretty');for(const name of await fs.readdir(previous)){if(!name.endsWith('.kicad_mod'))continue;const destination=path.join(pretty,name);try{await fs.copyFile(path.join(previous,name),destination,require('node:fs').constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;if(!(await fs.readFile(destination)).equals(await fs.readFile(path.join(previous,name))))throw new Error('新封装库中存在不同内容的同名文件：'+name);}}}
    for(const name of await fs.readdir(pretty))if(name.endsWith('.kicad_mod')&&!footprintOwners.has(name.slice(0,-10)))footprintOwners.set(name.slice(0,-10),'unmanaged');
    let localIndex=[];try{localIndex=await libraryIndex('kicad',settings);}catch(e){log('本地封装库不可用，回退立创：'+e.message);}
    const unique=[...new Map(resources.map(x=>[x.id,x])).values()];
    const previous=await existingLibrary('kicad',unique.map(r=>r.id),settings);
    for(let index=0;index<unique.length;index++) {
      const resource=unique[index];log(`KiCad ${index+1}/${unique.length}：${resource.id}`);
      try {
        const prior=previous.get(resource.id);
        if(prior?.complete){log(`${resource.id}：原理图库、封装和模型已存在，跳过转换`);results.push({...prior.report,id:resource.id,status:'converted',reused:true,reusedSymbol:true,reusedFootprint:true,entry:prior.entry,footprintEntry:prior.footprintEntry,warnings:['已存在，跳过转换。']});continue;}
        const part=await readComponent(resource.folder);if(part.id!==resource.id)throw new Error('资源编号与文件内容不一致');
        const incomingModel=modelInfo(part.manifest);
        const replaceModel=!!prior?.modelExists && prior.modelPlaceholder && !incomingModel.placeholder;
        const selectedSource=prior?.modelExists && !replaceModel?(prior.report?.model || {kind:'real',placeholder:false}):incomingModel;
        if(prior?.modelExists && !replaceModel)part.model=prior.modelFile;else await restoreModelColors(part,settings,log);
        if(replaceModel)log(`${part.id}：真实模型替换高度占位模型，保留原理图与焊盘`);
        else if(selectedSource.placeholder)log(`${part.id}：使用高度占位模型（后续允许真实模型替换）`);
        const entry=prior?.entry || uniqueName(part.name,part.id,symbolOwners,part.properties.Manufacturer||part.id);
        const footprintEntry=prior?.footprintEntry || uniqueName(part.footprintTitle,part.id,footprintOwners,part.name);
        const symbol=prior?.symbolExists?{text:symbols.get(entry),pins:[],warnings:[],units:prior.report?.units || 1}:convertSymbol(part,entry,footprintLibrary,footprintEntry);
        if(prior?.symbolExists){symbol.text=symbols.get(entry);const tree=sx.parse(symbol.text);symbol.pins=sx.children(tree,'symbol').flatMap(unit=>sx.children(unit,'pin').map(pin=>({number:sx.value(sx.child(pin,'number'))})));log(`${part.id}：原理图库已存在，跳过符号转换`);}
        const normalized={pads:[],warnings:[]};
        const targetModel=path.join(shapes,part.id+'.step');let fp,nativeLog='',footprintSource='easyeda',sourceFootprint;
        if(prior?.footprintExists) {
          const text=await fs.readFile(prior.footprintFile,'utf8'),tree=sx.parse(text);
          if(sx.name(tree)!=='footprint')throw new Error('已有封装格式无效');
          fp={text,pads:sx.children(tree,'pad').map(p=>({number:sx.value(p)}))};
          footprintSource=prior.report?.footprintSource || 'easyeda';sourceFootprint=prior.report?.sourceFootprint;
          log(`${part.id}：封装已存在，跳过封装转换`);
        }else {
        Object.assign(normalized,normalizeFootprint(part.footprintRows));
        const fpInput=path.join(scratch,part.id+'.elibz'),fpOutput=path.join(scratch,part.id+'.pretty');
        const fpUUID=part.manifest.device?.footprint?.uuid||part.properties.Footprint||'footprint';
        const zip=new JSZip();zip.file('FOOTPRINT/'+fpUUID+'.efoo',part.footprintRows.map(JSON.stringify).join('\n')+'\n');
        zip.file('footprint.json',JSON.stringify({footprints:{[fpUUID]:{title:footprintEntry,source:'',version:'1',type:4,desc:part.description,tags:[],custom_tags:[]}}}));
        await fs.writeFile(fpInput,await zip.generateAsync({type:'nodebuffer'}));
        nativeLog=await run(settings.kicadCli,['fp','upgrade','--output',fpOutput,fpInput],config);
        const nativeFiles=(await fs.readdir(fpOutput)).filter(x=>x.endsWith('.kicad_mod'));if(nativeFiles.length!==1)throw new Error('KiCad 未生成唯一封装');
        await fs.access(part.model);
        fp=patchFootprint(await fs.readFile(path.join(fpOutput,nativeFiles[0]),'utf8'),part,footprintEntry,targetModel,normalized.pads);
        const matched=matchFootprint(part.footprintTitle,localIndex);
        if(matched){try{fp=useKiCadFootprint(await fs.readFile(matched.file,'utf8'),part,footprintEntry,targetModel,normalized.pads);footprintSource='eda';sourceFootprint=matched.file;log('使用 KiCad 本地封装：'+matched.name);}catch(e){normalized.warnings.push('本地封装回退立创：'+e.message);}}
        else if(settings.kicadFootprintSource==='eda')normalized.warnings.push('未找到唯一的本地封装，使用立创封装。');
        fp.text=embedModel(fp.text,part.id,await fs.readFile(part.model));
        }
        const modelBytes=await fs.readFile(part.model);
        if(replaceModel)fp.text=embedModel(fp.text,part.id,modelBytes);
        const padNumbers=new Set(fp.pads.map(x=>x.number).filter(Boolean)),pinNumbers=new Set(symbol.pins.map(x=>x.number));
        for(const pin of pinNumbers)if(!padNumbers.has(pin))throw new Error(`符号引脚 ${pin} 在封装中没有对应焊盘`);
        for(const pad of padNumbers)if(!pinNumbers.has(pad))throw new Error(`封装焊盘 ${pad} 在符号中没有对应引脚`);
        const validationSymbol=path.join(scratch,part.id+'.kicad_sym');await fs.writeFile(validationSymbol,`(kicad_symbol_lib (version 20231120) (generator eda_component_hub) ${symbol.text})`);
        await run(settings.kicadCli,['sym','export','svg','--output',path.join(scratch,part.id+'-symbol-preview'),validationSymbol],config);
        const validationPretty=path.join(scratch,part.id+'-validation.pretty');await fs.mkdir(validationPretty);await fs.writeFile(path.join(validationPretty,footprintEntry+'.kicad_mod'),fp.text);
        await run(settings.kicadCli,['fp','export','svg','--output',path.join(scratch,part.id+'-footprint-preview'),validationPretty],config);
        if(!prior?.modelExists || replaceModel)await atomicWrite(targetModel,modelBytes);if(!prior?.footprintExists || replaceModel)await atomicWrite(path.join(pretty,footprintEntry+'.kicad_mod'),fp.text);
        const old=oldEntries.get(part.id);if(old){symbols.delete(old.symbol);if(old.footprint!==footprintEntry)obsoleteFootprints.add(old.footprint);}
        symbols.set(entry,symbol.text);symbolOwners.set(entry,part.id);footprintOwners.set(footprintEntry,part.id);
        const report={id:part.id,name:part.name,status:'converted',reusedSymbol:!!prior?.symbolExists,reusedFootprint:!!prior?.footprintExists,folder:resource.folder,entry,footprintEntry,library,footprintLibrary,footprintSource,sourceFootprint,units:symbol.units,pinCount:symbol.pins.length,padCount:fp.pads.length,warnings:[...new Set([...symbol.warnings,...normalized.warnings])],nativeLog,
          geometry:{symbolPins:symbol.pins,footprintPads:fp.pads},model:prior?.footprintExists && prior.report?.model ? prior.report.model : {path:library+'.3dshapes/'+part.id+'.step',reference:'kicad-embed://'+part.id+'.step',embedded:true,offsetMm:[fp.placement?.x || 0,fp.placement?.y || 0,0],rotationDeg:[0,0,fp.placement?.angle || 0],scale:[1,1,1]}};
        report.model={...report.model,...selectedSource};report.modelReplaced=!!replaceModel;
        if(report.model.placeholder)report.warnings.push('3D 模型为按器件高度生成的占位模型；再次导出时允许真实模型替换。');
        await atomicWrite(targetModel+'.json',JSON.stringify({modelName:part.id+'.step',kind:report.model.kind,placeholder:report.model.placeholder,sourceModelUuid:report.model.sourceModelUuid,sourceModelName:report.model.sourceModelName,updatedAt:report.model.updatedAt},null,2));
        await fs.writeFile(path.join(output,part.id+'_conversion.json'),JSON.stringify(report,null,2));results.push(report);
      } catch(error) {results.push({id:resource.id,status:'failed',folder:resource.folder,message:error.message});log(`${resource.id} 转换失败：${error.message}`);}
    }
    await fs.writeFile(path.join(output,'conversion_report.json'),JSON.stringify({schema:'component-hub-kicad/v1',kiCadVersion:version,library,createdAt:new Date().toISOString(),results},null,2));
    const converted=results.filter(x=>x.status==='converted').length;
    if(!converted)throw new Error('所有元件转换失败；原库已保留。报告保存在：'+output);
    const merged=`(kicad_symbol_lib (version 20231120) (generator eda_component_hub)\n${[...symbols.values()].join('\n')}\n)\n`;
    const validationMerged=path.join(scratch,'merged.kicad_sym');await fs.writeFile(validationMerged,merged);
    await run(settings.kicadCli,['sym','export','svg','--output',path.join(scratch,'merged-preview'),validationMerged],config);
    if(results.some(r=>r.status==='converted' && !r.reusedSymbol) || priorLibrary!==footprintLibrary)await atomicWrite(symbolFile,merged);
    const referenced=new Set([...symbols.values()].map(text=>{const binding=sx.children(sx.parse(text),'property').find(p=>sx.value(p)==='Footprint');return (sx.value(binding,2)||'').split(':').slice(1).join(':');}));
    for(const name of obsoleteFootprints)if(!referenced.has(name)&&path.basename(name)===name)await fs.unlink(path.join(pretty,name+'.kicad_mod')).catch(()=>{});
    await atomicWrite(configFile,JSON.stringify({schema:'component-hub-kicad-settings/v1',symbolLibrary:library,footprintLibrary},null,2));
    await fs.writeFile(path.join(output,'sym-lib-table'),`(sym_lib_table (version 7) (lib (name "LCSC") (type "KiCad") (uri "\${KIPRJMOD}/LCSC.kicad_sym") (options "") (descr "LCSC Component Hub")))\n`);
    await fs.writeFile(path.join(output,'fp-lib-table'),`(fp_lib_table (version 7) (lib (name ${quote(footprintLibrary)}) (type "KiCad") (uri ${quote('${KIPRJMOD}/'+footprintLibrary+'.pretty')}) (options "") (descr "LCSC Component Hub")))\n`);
    await fs.writeFile(path.join(output,'使用说明.txt'),`KiCad ${version} 固定元件库\n\n1. 在原理图编辑器“管理符号库”中添加 LCSC.kicad_sym；在 PCB 编辑器“管理封装库”中添加 ${footprintLibrary}.pretty。符号库昵称为 LCSC，封装库昵称必须为 ${footprintLibrary}，与设置一致。只需添加一次。\n2. 符号按型号、封装按原始封装名称命名，后续转换按内部 C 编号识别已有元件，已有资源跳过，仅补齐缺失部分。同名器件补充品牌或型号区分。\n3. 模型使用 kicad-embed://C编号.step 资源相对引用，彩色 STEP 内嵌在封装中，移动库或复制封装到其他工程后仍可使用，不依赖原电脑路径。独立 STEP 同时保存在 LCSC.3dshapes。\n4. 库搬动后，仅重新指定两个库表的库文件位置，无需逐颗修改 3D 模型。修改封装库名称后重新转换，将复制旧封装库并更新所有已有符号绑定；旧目录保留，不自动删除。\n5. 附带 sym-lib-table、fp-lib-table 使用 KIPRJMOD 相对路径，适用于库位于工程根目录的情况；不要覆盖已有工程库表。其他位置请通过 KiCad 管理库添加。\n6. conversion_report.json 为最近一次转换报告，C编号_conversion.json 为各元件的最近成功报告。源库未定义的引脚类型保持 unspecified，投板前核对数据手册和 ERC。\n`);
    for(const report of results.filter(x=>x.status==='converted' && x.folder)) {
      const file=path.join(report.folder,'component.json');let metadata;try{metadata=JSON.parse(await fs.readFile(file,'utf8'));}catch{continue;}
      metadata.conversions={...metadata.conversions,kicad:{status:'converted',folder:output,library,entry:report.entry,footprintLibrary,footprintEntry:report.footprintEntry,createdAt:new Date().toISOString(),warnings:report.warnings}};
      await fs.writeFile(file,JSON.stringify(metadata,null,2));
    }
    return {folder:output,library,results,converted,failed:results.length-converted};
  } finally {
    if(lock){await lock.close();await fs.unlink(path.join(output,'.conversion.lock')).catch(()=>{});}
    // Only remove the freshly created temporary workspace, never source resources.
    if(path.dirname(scratch)===os.tmpdir() && path.basename(scratch).startsWith('hub-kicad-'))await fs.rm(scratch,{recursive:true,force:true}).catch(()=>{});
  }
}
module.exports={detectKiCad,convertLibrary,normalizeFootprint,patchFootprint,run};
