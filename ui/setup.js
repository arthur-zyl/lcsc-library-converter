let setupStep=0,setupInitialized=false,setupBusy=false,setupDrafts={},setupTarget='kicad';
const setupElement=id=>document.getElementById(id);
async function setupCall(action,value){try{return await window.hub.call(action,value);}catch(error){return {ok:false,message:error.message};}}
const setupNames={kicad:'kicadFootprintLibraryName',cadence:'cadenceLibraryName',altium:'altiumLibraryName'};
function setupMessage(message,error=false){setupElement('setup-message').textContent=message || '';setupElement('setup-message').dataset.error=String(error);}
function setupStoreDraft(){setupDrafts[setupTarget]={tool:setupElement('setup-tool').value,output:setupElement('setup-output').value,library:setupElement('setup-library').value};}
function setupChooseTarget(target){
  setupTarget=target;setupElement('setup-target').value=target;
  const draft=setupDrafts[target];setupElement('setup-tool').value=draft.tool;setupElement('setup-output').value=draft.output;setupElement('setup-library').value=draft.library;
  setupElement('setup-tool-field').hidden=target==='altium';setupElement('setup-ad-note').hidden=target!=='altium';
  setupElement('setup-tool-label').textContent=target==='cadence'?'Cadence 安装目录':'KiCad CLI 路径';
  setupElement('setup-tool-help').textContent=target==='cadence'?'选择 SPB 安装目录。需要完整的 Capture / Allegro 工具和可用许可证。':'安装 KiCad 9 或更新版本，选择 bin 文件夹中的 kicad-cli.exe。';
  setupElement('setup-tool-pick').textContent=target==='cadence'?'选择文件夹':'选择文件';
  setupElement('setup-download-kicad').hidden=target!=='kicad';
  setupElement('setup-library-label').textContent=target==='kicad'?'KiCad 封装库名称':target==='cadence'?'Capture 库名称':'AD 库名称';
  setupElement('setup-library-help').textContent=target==='kicad'?'与 KiCad 中注册的封装库昵称保持一致，符号会自动绑定这个库名。':target==='cadence'?'生成同名 .olb 原理图库，封装与模型保存在同一目录。':'生成同名 .SchLib 和 .PcbLib，STEP 模型嵌入封装库。';
}
function renderSetup(s){
  const visible=s.page==='setup';setupElement('setup').hidden=!visible;
  setupElement('setup-return').hidden=setupStep!==2 || !setupInitialized || visible || s.edaLocked;
  setupElement('setup-open').disabled=!!s.bridge.active || s.processing || s.converting;
  if(visible && !setupInitialized){
    setupInitialized=true;setupStep=0;
    setupElement('setup-python').value=s.settings.freecadPython || '';
    for(const target of ['kicad','cadence','altium'])setupDrafts[target]={tool:s.settings[target==='cadence'?'cadenceRoot':'kicadCli'] || '',output:s.settings[target+'Dir'] || '',library:s.settings[setupNames[target]] || 'LCSC'};
    setupChooseTarget(s.exportTarget || 'kicad');setupMessage('');
  }
  document.querySelectorAll('[data-setup-panel]').forEach(x=>x.hidden=Number(x.dataset.setupPanel)!==setupStep);
  document.querySelectorAll('[data-setup-step]').forEach(x=>{x.classList.toggle('active',Number(x.dataset.setupStep)===setupStep);x.classList.toggle('done',Number(x.dataset.setupStep)<setupStep);if(Number(x.dataset.setupStep)===setupStep)x.setAttribute('aria-current','step');else x.removeAttribute('aria-current');});
  setupElement('setup-back').hidden=setupStep===0;setupElement('setup-later').hidden=setupStep===2;
  setupElement('setup-next').textContent=setupBusy?'正在检测…':setupStep===0?'检测并继续':setupStep===1?'保存并继续':s.bridge.connected && s.edaLogin==='signed-in'?'完成设置':'完成，稍后连接';
  setupElement('setup-login-status').textContent='账号登录：'+({'signed-in':'已登录','signed-out':'未登录',checking:'正在检查'}[s.edaLogin] || '待确认');
  setupElement('setup-plugin-status').textContent='连接插件：'+(s.bridge.connected?'已连接':'未连接');
  for(const control of setupElement('setup-form').querySelectorAll('input,select,button'))control.disabled=setupBusy || !!s.settingsBusy || s.processing || s.converting || !!s.bridge.active;
}
async function setupPick(key,input){const result=await call('settings-pick',key);if(result?.path){setupElement(input).value=result.path;setupMessage('');}}
document.querySelectorAll('[data-setup-pick]').forEach(button=>button.addEventListener('click',()=>setupPick(button.dataset.setupPick,button.dataset.setupInput)));
setupElement('setup-tool-pick').addEventListener('click',()=>setupPick(setupTarget==='cadence'?'cadenceRoot':'kicadCli','setup-tool'));
setupElement('setup-output-pick').addEventListener('click',()=>setupPick(setupTarget+'Dir','setup-output'));
setupElement('setup-target').addEventListener('change',()=>{setupStoreDraft();setupChooseTarget(setupElement('setup-target').value);setupMessage('');});
for(const tool of ['freecad','kicad'])setupElement('setup-download-'+tool).addEventListener('click',()=>call('setup-download',tool));
setupElement('setup-detect').addEventListener('click',async()=>{
  setupBusy=true;renderSetup(state);setupMessage('正在查找常见安装目录…');
  try{const found=await setupCall('setup-detect');if(!found?.ok){setupMessage(found?.message || '检测失败，请手动选择路径。',true);return;}
    if(found.freecadPython)setupElement('setup-python').value=found.freecadPython;
    setupStoreDraft();if(found.kicadCli)setupDrafts.kicad.tool=found.kicadCli;if(found.cadenceRoot)setupDrafts.cadence.tool=found.cadenceRoot;setupChooseTarget(setupTarget);
    setupMessage(found.freecadPython?'已找到 FreeCAD，点击「检测并继续」验证是否可用。':'未找到 FreeCAD。请下载安装，或手动选择已有安装路径。',!found.freecadPython);
  }finally{setupBusy=false;renderSetup(state);}
});
setupElement('setup-back').addEventListener('click',()=>{setupStep--;setupMessage('');renderSetup(state);setupElement('setup').scrollTop=0;});
setupElement('setup-later').addEventListener('click',()=>call('page','shop'));
setupElement('setup-open').addEventListener('click',()=>{setupInitialized=false;call('page','setup');});
setupElement('setup-return').addEventListener('click',()=>call('page','setup'));
setupElement('setup-eda').addEventListener('click',()=>call('open-login'));
setupElement('setup-plugin').addEventListener('click',async()=>{const r=await call('plugin-path');if(r?.ok)setupMessage(r.message);});
setupElement('setup-form').addEventListener('submit',async event=>{
  event.preventDefault();if(setupBusy)return;setupBusy=true;renderSetup(state);setupMessage('');
  try{
    let result;
    if(setupStep===0)result=await setupCall('setup-check',{freecadPython:setupElement('setup-python').value});
    else if(setupStep===1){
      const value={target:setupTarget,freecadPython:setupElement('setup-python').value,[setupTarget+'Dir']:setupElement('setup-output').value,[setupNames[setupTarget]]:setupElement('setup-library').value};
      if(setupTarget!=='altium')value[setupTarget==='cadence'?'cadenceRoot':'kicadCli']=setupElement('setup-tool').value;
      result=await setupCall('setup-save',value);
    }else result=await setupCall('setup-finish');
    if(!result?.ok){setupMessage(result?.message || '配置未完成，请检查路径后重试。',true);return;}
    if(setupStep<2){setupStep++;setupElement('setup').scrollTop=0;}
    else setupInitialized=false;
    const updated=await call('state');if(updated)render(updated);
  }finally{setupBusy=false;renderSetup(state);}
});

setupElement('setup-tool-detect').addEventListener('click',async()=>{
  setupBusy=true;renderSetup(state);setupMessage('正在检测安装路径…');
  try{const result=await setupCall('settings-detect',setupTarget==='cadence'?'cadenceRoot':'kicadCli');
    if(result?.ok && result.path){setupElement('setup-tool').value=result.path;setupMessage('已找到安装路径，保存并继续时会检查工具。');}
    else setupMessage(result?.message || '未找到安装，请手动选择路径。',true);
  }finally{setupBusy=false;renderSetup(state);}
});
