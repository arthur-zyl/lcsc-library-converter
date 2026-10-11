const {randomUUID}=require('node:crypto');
// A page's beforeunload veto is silent in embedded Electron views unless the
// host handles will-prevent-unload. Retry only after explicit user confirmation.
function navigationController(contents,{blocked,error}){
  let attempt,pending,allowUnload=false;
  contents.on('will-prevent-unload',event=>{
    if(allowUnload){allowUnload=false;event.preventDefault();return;}
    if(!attempt){error('网页阻止离开，请先保存修改。');return;}
    pending={...attempt,id:randomUUID()};attempt=undefined;blocked(pending);
  });
  const complete=()=>{attempt=undefined;allowUnload=false;};
  contents.on('did-finish-load',complete);
  contents.on('did-navigate-in-page',complete);
  function perform(action,url,approved=false){
    attempt={action,url};allowUnload=approved;
    if(action==='navigate')contents.loadURL(url).catch(e=>{if(e.code!=='ERR_ABORTED'&&e.errno!==-3)error('网页打开失败：'+e.message);});
    else if(action==='refresh')contents.reload();
    else if(action==='back'||action==='forward'){
      const history=contents.navigationHistory,available=action==='back'?history.canGoBack():history.canGoForward();
      if(!available){complete();return;}
      if(action==='back')history.goBack();else history.goForward();
    }else throw new Error('未知导航操作');
  }
  return {perform,confirm(id,accepted){
    if(!pending||pending.id!==id)throw new Error('导航确认已失效');
    const request=pending;pending=undefined;
    if(accepted)perform(request.action,request.url,true);else complete();
  }};
}
module.exports={navigationController};
