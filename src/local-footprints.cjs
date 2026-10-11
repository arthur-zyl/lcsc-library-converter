const fs=require('node:fs/promises'),path=require('node:path');
const sx=require('./sexpr.cjs');
function key(name){return String(name).toUpperCase().replace(/[^A-Z0-9.]/g,'').replace(/^SMC(?=\d)/,'C').replace(/^SMR(?=\d)/,'R').replace(/^SO(?=\d)/,'SOIC').replace(/^SOP(?=\d)/,'SOIC');}
function family(name){
  const raw=String(name).toUpperCase().replace(/[^A-Z0-9.]+/g,'_').replace(/^SOP(?=_?\d)/,'SOIC').replace(/^SO(?=_?\d)/,'SOIC');
  const ic=raw.match(/^(SOIC|TSSOP|SSOP|QFN|DFN|LQFP|QFP|BGA)_?(\d+)/);
  return ic?ic[1]+ic[2]:key(name).match(/^[CR](?:0201|0402|0603|0805|1206|1210|1812|2010|2512)/)?.[0];
}
function nameSpec(name){
  const s=String(name).toUpperCase(),dimensions=s.match(/(?:^|[_-])(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)MM/),length=s.match(/(?:^|[_-])L(\d+(?:\.\d+)?)/),width=s.match(/(?:^|[_-])W(\d+(?:\.\d+)?)/),pitch=s.match(/(?:^|[_-])P(\d+(?:\.\d+)?)/);
  return {dimensions:dimensions?[Number(dimensions[1]),Number(dimensions[2])].sort((a,b)=>a-b):length&&width?[Number(length[1]),Number(width[1])].sort((a,b)=>a-b):null,pitch:pitch?Number(pitch[1]):null};
}
async function libraryIndex(provider,settings){
  if(settings[provider+'FootprintSource']!=='eda')return [];
  const root=settings[provider+'FootprintDir'] || (provider==='kicad'?path.resolve(path.dirname(settings.kicadCli),'../share/kicad/footprints'):path.join(settings.cadenceRoot,'share/pcb/pcb_lib/symbols'));
  const result=[];const ext=provider==='kicad'?'.kicad_mod':'.dra';
  async function scan(folder,depth){for(const file of await fs.readdir(folder,{withFileTypes:true})){if(file.isDirectory() && depth<2)await scan(path.join(folder,file.name),depth+1);else if(file.isFile() && file.name.toLowerCase().endsWith(ext))result.push({name:file.name.slice(0,-ext.length),file:path.join(folder,file.name)});}}
  await scan(root,0);return result;
}
function matchFootprint(title,index){
  const exact=index.filter(item=>key(item.name)===key(title));if(exact.length===1)return exact[0];if(exact.length>1)return;
  const f=family(title);if(!f)return;
  const source=nameSpec(title);
  const candidates=index.filter(item=>{
    if(family(item.name)!==f || /HAND.?SOLDER|THERMAL.?VIAS/i.test(item.name))return false;
    const target=nameSpec(item.name);
    return !(source.pitch!==null && target.pitch!==null && Math.abs(source.pitch-target.pitch)>0.01) && !(source.dimensions && target.dimensions && source.dimensions.some((d,i)=>Math.abs(d-target.dimensions[i])>0.2));
  });
  return candidates.length===1?candidates[0]:undefined;
}
// A rigid two-anchor fit aligns the downloaded STEP; it does not compare pad sizes or holes.
function modelPlacement(source,target){
  const unique=pads=>{const map=new Map();for(const p of pads.filter(p=>p.number)){if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new Error('焊盘坐标无效');if(map.has(p.number))throw new Error('重复焊盘编号需要人工对齐');map.set(p.number,p);}return map;};
  const a=unique(source),b=unique(target);if(a.size!==b.size || [...a.keys()].some(n=>!b.has(n)))throw new Error('焊盘编号不对应');
  const ids=[...a.keys()];if(ids.length<2)throw new Error('模型对齐至少需要两个编号焊盘');
  const p=a.get(ids[0]),q=b.get(ids[0]),next=ids.find(n=>Math.hypot(a.get(n).x-p.x,a.get(n).y-p.y)>0.01);if(!next)throw new Error('无法确定模型方向');
  const v=a.get(next),w=b.get(next),angle=Math.atan2(w.y-q.y,w.x-q.x)-Math.atan2(v.y-p.y,v.x-p.x),c=Math.cos(angle),s=Math.sin(angle);
  // Check both spans after rotation: matching pitch alone cannot identify a two-row package.
  const rotated=ids.map(n=>{const p=a.get(n);return {x:c*p.x-s*p.y,y:s*p.x+c*p.y};});
  const targetPoints=ids.map(n=>b.get(n));
  for(const axis of ['x','y']) {
    const span=pads=>Math.max(...pads.map(p=>p[axis]))-Math.min(...pads.map(p=>p[axis]));
    const sourceSpan=span(rotated),targetSpan=span(targetPoints);
    if(Math.abs(sourceSpan-targetSpan)>0.15+1e-8)throw new Error(`焊盘排距或跨度不一致（${axis}：立创 ${sourceSpan.toFixed(3)} mm，本地 ${targetSpan.toFixed(3)} mm），引脚排列无法对齐立创模型`);
  }
  const x=ids.reduce((sum,n)=>sum+b.get(n).x-c*a.get(n).x+s*a.get(n).y,0)/ids.length,y=ids.reduce((sum,n)=>sum+b.get(n).y-s*a.get(n).x-c*a.get(n).y,0)/ids.length;
  for(const n of ids){const a1=a.get(n),b1=b.get(n);if(Math.hypot(c*a1.x-s*a1.y+x-b1.x,s*a1.x+c*a1.y+y-b1.y)>0.25)throw new Error('引脚排列无法对齐立创模型');}
  return {x,y,angle:angle*180/Math.PI};
}
function useKiCadFootprint(text,part,entry,model,sourcePads){
  const tree=sx.parse(text);if(sx.name(tree)!=='footprint')throw new Error('本地封装格式无效');tree[1]=sx.str(entry);
  const pads=sx.children(tree,'pad').map(p=>({number:sx.value(p),type:sx.value(p,2),x:Number(sx.value(sx.child(p,'at'))),y:Number(sx.value(sx.child(p,'at'),2)),width:Number(sx.value(sx.child(p,'size'))),height:Number(sx.value(sx.child(p,'size'),2))}));
  const alignment=modelPlacement(sourcePads.map(p=>({number:String(p[5]??''),x:Number(p[6])*0.0254,y:Number(p[7])*0.0254})),pads.map(p=>({...p,y:-p.y})));
  // STEP uses right-handed XY. KiCad applies the negative of the model's
  // stored Euler angle (independently of the footprint's 2D angle).
  const placement={...alignment,angle:-alignment.angle || 0};
  for(let i=tree.length-1;i>=0;i--)if(['model','embedded_files'].includes(sx.name(tree[i])))tree.splice(i,1);
  tree.push(sx.parse(`(model ${JSON.stringify(model.replaceAll('\\','/'))} (offset (xyz ${placement.x} ${placement.y} 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 ${placement.angle})))`));
  const value=sx.children(tree,'property').find(p=>sx.value(p)==='Value');if(value)value[2]=sx.str(part.name);
  return {text:sx.write(tree)+'\n',pads,placement};
}
module.exports={key,family,libraryIndex,matchFootprint,modelPlacement,useKiCadFootprint};
