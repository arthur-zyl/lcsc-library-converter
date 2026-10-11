const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {navigationController}=require('../src/browser-navigation.cjs');
function setup(){
 const wc=new EventEmitter(),calls=[],prompts=[],errors=[];
 wc.loadURL=async url=>calls.push(['navigate',url]);wc.reload=()=>calls.push(['refresh']);
 wc.navigationHistory={canGoBack:()=>true,canGoForward:()=>true,goBack:()=>calls.push(['back']),goForward:()=>calls.push(['forward'])};
 const controller=navigationController(wc,{blocked:p=>prompts.push(p),error:e=>errors.push(e)});
 const veto=()=>{let ignored=false;wc.emit('will-prevent-unload',{preventDefault(){ignored=true;}});return ignored;};
 return {wc,calls,prompts,errors,controller,veto};
}
test('navigation veto requires explicit confirmation and cancellation preserves page',()=>{
 const s=setup();s.controller.perform('refresh');assert.equal(s.veto(),false);
 s.controller.confirm(s.prompts[0].id,false);assert.deepEqual(s.calls,[['refresh']]);
 assert.throws(()=>s.controller.confirm(s.prompts[0].id,true),/失效/);
});
test('confirmed retry bypasses only one veto and in-page navigation clears approval',()=>{
 const s=setup();s.controller.perform('back');s.veto();s.controller.confirm(s.prompts[0].id,true);
 assert.equal(s.veto(),true);assert.equal(s.veto(),false);
 assert.deepEqual(s.calls,[['back'],['back']]);
 s.controller.perform('navigate','https://pro.lceda.cn/editor');s.veto();s.controller.confirm(s.prompts.at(-1).id,true);
 s.wc.emit('did-navigate-in-page');assert.equal(s.veto(),false);assert.match(s.errors.at(-1),/保存/);
});
test('stale approval and untracked page navigation cannot silently discard changes',()=>{
 const s=setup();s.controller.perform('forward');s.veto();assert.throws(()=>s.controller.confirm('wrong',true),/失效/);
 assert.equal(s.calls.length,1);s.controller.confirm(s.prompts[0].id,false);assert.equal(s.veto(),false);
 assert.equal(s.errors.length,1);
});
