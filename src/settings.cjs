const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {libraryName}=require('./kicad-names.cjs');
function paths(store) {
  return {freecadPython:store.state.freecadPython,kicadFootprintSource:store.state.kicadFootprintSource||'easyeda',cadenceFootprintSource:store.state.cadenceFootprintSource||'easyeda',kicadFootprintDir:store.state.kicadFootprintDir||'',cadenceFootprintDir:store.state.cadenceFootprintDir||'',
    altiumDir:store.state.altiumDir||path.join(store.root,'altium'),altiumLibraryName:store.state.altiumLibraryName||'LCSC',altiumFootprintSource:store.state.altiumFootprintSource||'easyeda',altiumFootprintDir:store.state.altiumFootprintDir||'',
    resourceDir:store.state.resourceDir || path.join(store.root,'resources'),
    downloadDir:store.state.downloadDir || path.join(store.root,'downloads'),
    kicadCli:store.state.kicadCli || '',kicadDir:store.state.kicadDir || path.join(store.root,'kicad'),kicadFootprintLibraryName:store.state.kicadFootprintLibraryName || 'LCSC',
    cadenceRoot:store.state.cadenceRoot||'',cadenceDir:store.state.cadenceDir||path.join(store.root,'cadence'),cadenceLibraryName:store.state.cadenceLibraryName||'LCSC'};
}
async function saveSettings(store, input, {target,group}={}) {
  if(group)return saveGroup(store,input,group);
  const settings = {};
  for(const provider of ['kicad','cadence','altium']) {
    const source=input?.[provider+'FootprintSource'] ?? paths(store)[provider+'FootprintSource'];
    if(!['easyeda','eda'].includes(source))throw new Error('封装来源无效');
    const folder=(input?.[provider+'FootprintDir'] ?? paths(store)[provider+'FootprintDir']).trim();
    if(folder && (!path.isAbsolute(folder) || !(await fs.stat(folder).catch(()=>null))?.isDirectory()))throw new Error('本地封装库目录无效');
    settings[provider+'FootprintSource']=source;settings[provider+'FootprintDir']=folder;
  }
  settings.kicadFootprintLibraryName=libraryName(input?.kicadFootprintLibraryName===undefined ? paths(store).kicadFootprintLibraryName : input.kicadFootprintLibraryName);
  settings.cadenceLibraryName=libraryName(input?.cadenceLibraryName===undefined ? paths(store).cadenceLibraryName : input.cadenceLibraryName);
  settings.altiumLibraryName=libraryName(input?.altiumLibraryName??paths(store).altiumLibraryName);
  settings.altiumDir=typeof input?.altiumDir==='string'?input.altiumDir.trim():paths(store).altiumDir;
  if(!settings.altiumDir||!path.isAbsolute(settings.altiumDir))throw new Error('AD 库导出目录需要完整的绝对路径。');
  settings.cadenceRoot=typeof input?.cadenceRoot==='string'?input.cadenceRoot.trim():paths(store).cadenceRoot;
  if(settings.cadenceRoot && (!target || target==='cadence')) {
    if(!path.isAbsolute(settings.cadenceRoot))throw new Error('Cadence 安装目录需要完整的绝对路径。');
    for(const file of ['tools/bin/tclsh.exe','tools/bin/orDb_Dll_Tcl64.dll','tools/bin/allegro.exe'])await fs.access(path.join(settings.cadenceRoot,file)).catch(()=>{throw new Error('Cadence 安装目录缺少 '+file);});
  }
  settings.cadenceDir=typeof input?.cadenceDir==='string'?input.cadenceDir.trim():paths(store).cadenceDir;
  if(!settings.cadenceDir||!path.isAbsolute(settings.cadenceDir))throw new Error('Cadence 库导出目录需要完整的绝对路径。');
  for (const [key,label] of [['freecadPython','FreeCAD Python'],['resourceDir','资源库目录'],['downloadDir','下载包目录']]) {
    const value = typeof input?.[key] === 'string' ? input[key].trim() : paths(store)[key];
    if (!value || !path.isAbsolute(value)) throw new Error(`${label}需要填写完整的绝对路径。`);
    settings[key] = path.normalize(value);
  }
  let python;
  settings.kicadCli = typeof input?.kicadCli==='string' ? input.kicadCli.trim() : paths(store).kicadCli;
  if(settings.kicadCli && (!target || target==='kicad')) {
    if(!path.isAbsolute(settings.kicadCli))throw new Error('KiCad CLI 需要完整的绝对路径。');
    const cli=await fs.stat(settings.kicadCli).catch(()=>null);if(!cli?.isFile())throw new Error('找不到 KiCad CLI，请选择 kicad-cli.exe。');
  }
  settings.kicadDir=typeof input?.kicadDir==='string' ? input.kicadDir.trim() : paths(store).kicadDir;
  if(!settings.kicadDir || !path.isAbsolute(settings.kicadDir))throw new Error('KiCad 库导出目录需要完整的绝对路径。');
  try { python = await fs.stat(settings.freecadPython); } catch { throw new Error('找不到 FreeCAD Python，请选择 FreeCAD bin 文件夹中的 python.exe。'); }
  if (!python.isFile()) throw new Error('FreeCAD Python 路径必须指向文件。');
  for (const key of [...(target?[target+'Dir']:['kicadDir','cadenceDir','altiumDir']),...(input?.resourceDir===undefined?[]:['resourceDir']),...(input?.downloadDir===undefined?[]:['downloadDir'])]) {
    const folder = settings[key]; const probe = path.join(folder, `.hub-write-${randomUUID()}.tmp`);
    try { await fs.mkdir(folder,{recursive:true}); await fs.writeFile(probe,'',{flag:'wx'}); }
    catch { throw new Error(`${{resourceDir:'资源库',downloadDir:'下载包',kicadDir:'KiCad 库',cadenceDir:'Cadence 库',altiumDir:'AD 库'}[key]}目录无法写入，请选择其他目录。`); }
    finally { await fs.unlink(probe).catch(()=>{}); }
  }
  const prior = {...store.state}; Object.assign(store.state,settings);
  try {await store.persist();} catch(error) {store.state=prior;throw error;}
  return settings;
}
async function saveGroup(store,input,group){
  if(!['general','kicad','cadence','altium'].includes(group))throw new Error('未知设置分组');
  const settings={},current=paths(store);
  const absolute=(key,label)=>{const value=String(input?.[key]??current[key]??'').trim();if(!value || !path.isAbsolute(value))throw new Error(label+'需要完整的绝对路径。');return value;};
  if(group==='general'){
    settings.freecadPython=absolute('freecadPython','FreeCAD Python');if(!(await fs.stat(settings.freecadPython).catch(()=>null))?.isFile())throw new Error('找不到 FreeCAD Python，请选择 bin/python.exe。');
  }else{
    const key=group+'FootprintSource',folderKey=group+'FootprintDir';settings[key]=input?.[key]??current[key];if(!['easyeda','eda'].includes(settings[key]))throw new Error('封装来源无效');
    settings[folderKey]=String(input?.[folderKey]??current[folderKey]??'').trim();if(settings[folderKey] && (!path.isAbsolute(settings[folderKey]) || !(await fs.stat(settings[folderKey]).catch(()=>null))?.isDirectory()))throw new Error('本地封装库目录无效');
    const nameKey=group==='kicad'?'kicadFootprintLibraryName':group+'LibraryName';settings[nameKey]=libraryName(input?.[nameKey]??current[nameKey]);
    const dirKey=group+'Dir';settings[dirKey]=absolute(dirKey,'库导出目录');
    const probe=path.join(settings[dirKey],'.hub-write-'+randomUUID());try{await fs.mkdir(settings[dirKey],{recursive:true});await fs.writeFile(probe,'',{flag:'wx'});}catch{throw new Error('库导出目录无法写入。');}finally{await fs.unlink(probe).catch(()=>{});}
    if(group==='kicad'){settings.kicadCli=String(input?.kicadCli??current.kicadCli??'').trim();if(settings.kicadCli && (!path.isAbsolute(settings.kicadCli) || !(await fs.stat(settings.kicadCli).catch(()=>null))?.isFile()))throw new Error('找不到 KiCad CLI。');}
    if(group==='cadence'){
      settings.cadenceRoot=String(input?.cadenceRoot??current.cadenceRoot??'').trim();if(settings.cadenceRoot){if(!path.isAbsolute(settings.cadenceRoot))throw new Error('Cadence 需要完整的安装路径。');for(const file of ['tclsh.exe','orDb_Dll_Tcl64.dll','allegro.exe'])if(!(await fs.stat(path.join(settings.cadenceRoot,'tools/bin',file)).catch(()=>null))?.isFile())throw new Error('Cadence 安装缺少 '+file);}
    }
  }
  const prior={...store.state};
  try{Object.assign(store.state,settings);await store.persist();}catch(e){store.state=prior;throw e;}
  return settings;
}
module.exports = {paths,saveSettings,saveGroup};
