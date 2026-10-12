const {contextBridge,ipcRenderer}=require('electron');
function applyLanguage(locale){
 const languages=locale==='zh-CN'?['zh-CN','zh']:['en-US','en'];
 contextBridge.executeInMainWorld({func:values=>{
  const languages=Object.freeze(values.slice());
  const changed=navigator.language!==languages[0];
  Object.defineProperties(navigator,{
   language:{configurable:true,get:()=>languages[0]},
   languages:{configurable:true,get:()=>languages}
  });
  if(changed)window.dispatchEvent(new Event('languagechange'));
 },args:[languages]});
}
applyLanguage(ipcRenderer.sendSync('browser:language'));
ipcRenderer.on('browser:language',(_event,locale)=>applyLanguage(locale));
