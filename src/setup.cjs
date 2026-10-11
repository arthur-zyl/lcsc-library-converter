const fs=require('node:fs/promises'),path=require('node:path');
const {spawn}=require('node:child_process');
const DOWNLOADS={freecad:'https://www.freecad.org/downloads.php',kicad:'https://www.kicad.org/download/windows/'};
async function detectFreeCAD(bases=[process.env.ProgramFiles || 'C:/Program Files',path.join(process.env.LOCALAPPDATA || 'C:/Users/Default/AppData/Local','Programs'),'C:/','D:/','E:/']) {
  for(const base of [...new Set(bases)]){
    const names=(await fs.readdir(base).catch(()=>[])).filter(n=>/^FreeCAD(?:\b|[-_])/i.test(n)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
    for(const name of names){const file=path.join(base,name,'bin','python.exe');if((await fs.stat(file).catch(()=>null))?.isFile())return file;}
  }
  return '';
}
function run(executable,args){return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,cwd:path.dirname(executable),env:{...process.env,PYTHONUTF8:'1'}});let out='',expired=false;
  const timer=setTimeout(()=>{expired=true;child.kill();},20000);
  const collect=x=>{out=(out+x.toString('utf8')).slice(-6000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.on('error',e=>{clearTimeout(timer);reject(new Error('工具无法启动：'+e.message));});
  child.on('close',code=>{clearTimeout(timer);if(expired)reject(new Error('工具检测超时，请检查安装是否完整。'));else if(code!==0)reject(new Error('工具检测失败，请选择正确的安装路径。\n'+out.slice(-1500)));else resolve(out);});
});}
async function checkTools(input,execute=run){
  const python=String(input?.freecadPython || '').trim();
  if(!path.isAbsolute(python) || !(await fs.stat(python).catch(()=>null))?.isFile())throw new Error('请安装 FreeCAD，并选择其 bin 文件夹中的 python.exe。');
  const probe=await execute(python,['-c','import FreeCAD, Part, Import, sys, json; s=Part.makeBox(1,1,1); assert not s.isNull(); print("HUB_TOOL="+json.dumps({"freecad":".".join(FreeCAD.Version()[:3]),"python":list(sys.version_info[:2])}))']);
  const match=probe.match(/HUB_TOOL=(\{[^\r\n]+\})/);if(!match)throw new Error('未能验证 FreeCAD 模型处理功能，请选择 FreeCAD 自带的 Python。');
  const info=JSON.parse(match[1]);
  if(!input.target)return {message:'FreeCAD '+info.freecad+'：模型处理功能可用。',info};
  await checkTarget(input,info,execute);
  return {message:'必要工具检测通过。',info};
}
async function checkTarget(input,info,execute=run){
  const python=String(input.freecadPython || '').trim();
  if(!['kicad','cadence','altium'].includes(input.target))throw new Error('请选择目标 EDA。');
  if(input.target==='kicad'){
    const cli=String(input.kicadCli || '').trim();if(!path.isAbsolute(cli) || !(await fs.stat(cli).catch(()=>null))?.isFile())throw new Error('请安装 KiCad 9 或更新版本，并选择 bin 文件夹中的 kicad-cli.exe。');
    const version=(await execute(cli,['version'])).trim();if(!/^(?:9|[1-9]\d)\./.test(version))throw new Error('需要 KiCad 9 或更新版本。');
  }
  if(input.target==='cadence')for(const file of ['tools/bin/tclsh.exe','tools/bin/orDb_Dll_Tcl64.dll','tools/bin/allegro.exe']){
    if(!path.isAbsolute(input.cadenceRoot || '') || !(await fs.stat(path.join(input.cadenceRoot,file)).catch(()=>null))?.isFile())throw new Error('请选择完整的 Cadence SPB 安装目录，缺少 '+file+'。');
  }
  if(input.target==='altium' && (!info || info.python[0]!==3 || info.python[1]!==11))throw new Error('AD 转换依赖 Python 3.11，请选择带 Python 3.11 的 FreeCAD 安装（如当前工具所验证的 FreeCAD 1.1）。');
  if(input.target==='altium')await execute(python,['-c',`import sys; sys.path.insert(0,${JSON.stringify(path.resolve(__dirname,'../tools/ad_vendor'))}); from altium_monkey import AltiumSchLib, AltiumPcbLib; print('AD_READY')`]);
  return true;
}
module.exports={DOWNLOADS,detectFreeCAD,checkTools,checkTarget};
