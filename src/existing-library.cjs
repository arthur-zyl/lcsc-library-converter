const fs=require('node:fs/promises'),path=require('node:path');
const sx=require('./sexpr.cjs');
const {libraryName}=require('./kicad-names.cjs');
async function exists(file){try{return (await fs.stat(file)).isFile();}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function json(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function existingLibrary(target,ids,settings){
  const output=settings[target+'Dir'],result=new Map();if(!output || !path.isAbsolute(output))return result;
  if(target==='kicad') {
    let text;try{text=await fs.readFile(path.join(output,'LCSC.kicad_sym'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
    const symbols=text?sx.children(sx.parse(text),'symbol'):[];
    for(const id of ids){
      const symbol=symbols.find(s=>sx.children(s,'property').some(p=>sx.value(p)==='LCSC' && sx.value(p,2)===id));
      const report=await json(path.join(output,id+'_conversion.json'));
      const binding=symbol?sx.value(sx.children(symbol,'property').find(p=>sx.value(p)==='Footprint'),2):'';
      const parts=(binding || '').split(':'),footprintEntry=parts.slice(1).join(':') || report?.footprintEntry;
      const footprintLibrary=libraryName(settings.kicadFootprintLibraryName || report?.footprintLibrary || parts[0] || 'LCSC');
      if(!footprintEntry || path.basename(footprintEntry)!==footprintEntry)continue;
      const footprintFile=path.join(output,footprintLibrary+'.pretty',footprintEntry+'.kicad_mod'),modelFile=path.join(output,'LCSC.3dshapes',id+'.step');
      const info={id,entry:symbol?sx.value(symbol):report?.entry,footprintEntry,footprintFile,modelFile,report,symbolExists:!!symbol,footprintExists:await exists(footprintFile),modelExists:await exists(modelFile)};
      info.modelPlaceholder=report?.model?.placeholder===true;
      info.complete=info.symbolExists && info.footprintExists && info.modelExists && !info.modelPlaceholder;result.set(id,info);
    }
  }else if(target==='cadence') {
    const state=await json(path.join(output,'hub_cadence.json'));if(!state)return result;
    if(state.schema!=='eda-component-hub/cadence-v1')throw new Error('Cadence 管理索引无效');
    const library=libraryName(settings.cadenceLibraryName || 'LCSC'),symbolExists=state.library===library && await exists(path.join(output,library+'.olb'));
    for(const id of ids){const record=state.entries.find(e=>e.id===id);if(!record)continue;
      if(!record.footprintEntry || path.basename(record.footprintEntry)!==record.footprintEntry)throw new Error('封装索引名称无效');
      const required=[record.footprintEntry+'.dra',record.footprintEntry+'.psm',...(record.files || []).filter(f=>f.endsWith('.pad'))];
      if(required.some(f=>path.basename(f)!==f))throw new Error('封装索引文件名无效');
      const owner=state.entries.find(e=>e.footprintEntry===record.footprintEntry);
      const modelName=owner?.modelName || record.footprintEntry+'.step';
      if(path.basename(modelName)!==modelName)throw new Error('模型索引文件名无效');
      const info={id,entry:record.entry,footprintEntry:record.footprintEntry,record,modelFile:path.join(output,modelName),symbolExists,
        footprintExists:(await Promise.all(required.map(f=>exists(path.join(output,f))))).every(Boolean)};
      info.modelExists=await exists(info.modelFile);info.modelPlaceholder=owner?.modelSource?.placeholder===true;
      info.complete=info.symbolExists && info.footprintExists && info.modelExists && !info.modelPlaceholder;result.set(id,info);
    }
  }else if(target==='altium'){
    const state=await json(path.join(output,'hub_altium.json'));if(!state)return result;
    if(state.schema!=='eda-component-hub/altium-v1'||!Array.isArray(state.entries))throw new Error('AD 管理索引无效');
    const library=libraryName(settings.altiumLibraryName||'LCSC');
    const symbolExists=state.library===library&&await exists(path.join(output,library+'.SchLib'));
    const footprintExists=state.library===library&&await exists(path.join(output,library+'.PcbLib'));
    for(const id of ids){const record=state.entries.find(e=>e.id===id);if(!record)continue;
      const owner=state.entries.find(e=>e.footprintEntry===record.footprintEntry),name=owner?.modelName||record.modelName;
      if(!name||path.basename(name)!==name)throw new Error('AD 模型索引名称无效');
      const info={id,entry:record.entry,footprintEntry:record.footprintEntry,record,symbolExists,footprintExists,modelFile:path.join(output,name),modelPlaceholder:owner?.modelSource?.placeholder===true};
      info.modelExists=await exists(info.modelFile);info.complete=symbolExists&&footprintExists&&info.modelExists&&!info.modelPlaceholder;result.set(id,info);
    }
  }
  return result;
}
module.exports={existingLibrary};
