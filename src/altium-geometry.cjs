const {componentFields}=require('./component-fields.cjs');
const {convertSymbol}=require('./kicad-symbol.cjs'),sx=require('./sexpr.cjs');
const {pathPoints}=require('./cadence-footprint.cjs');
const {isSupplyPinName}=require('./cadence-symbol.cjs');
const mm=n=>{const v=Number(n)*0.0254;if(!Number.isFinite(v))throw new Error('AD 封装坐标无效');return v;};
function geometry(part,entry,footprintEntry){
  const symbol=convertSymbol(part,entry,'AD',footprintEntry),tree=sx.parse(symbol.text),warnings=[...symbol.warnings];
  const shapes=sx.children(tree,'symbol').flatMap(u=>sx.children(u,'pin').map(p=>sx.value(p,2)));
  const pins=symbol.pins.map((p,i)=>({...p,shape:shapes[i],type:p.type==='unspecified'&&isSupplyPinName(p.name)?'power_in':p.type}));
  if(pins.some(p=>p.type==='unspecified'))warnings.push('AD 未定义引脚映射为 Passive，请核查电气类型。');
  warnings.push('AD 符号图形位置按 1 mil 取整；封装与引脚保留原始分辨率。');
  const point=n=>[Number(sx.value(n)),Number(sx.value(n,2))];
  const units=sx.children(tree,'symbol').map((unit,index)=>({unit:index+1,graphics:unit.slice(2).filter(g=>sx.name(g)!=='pin').map(g=>{
    const type=sx.name(g),width=Number(sx.value(sx.child(sx.child(g,'stroke')||[],'width'))||0.254),fill=sx.value(sx.child(sx.child(g,'fill')||[],'type'))==='outline';
    if(type==='rectangle')return {type,start:point(sx.child(g,'start')),end:point(sx.child(g,'end')),width,fill};
    if(type==='circle')return {type,center:point(sx.child(g,'center')),radius:Number(sx.value(sx.child(g,'radius'))),width,fill};
    if(type==='arc')return {type,start:point(sx.child(g,'start')),mid:point(sx.child(g,'mid')),end:point(sx.child(g,'end')),width};
    if(type==='polyline'||type==='bezier')return {type,points:sx.child(g,'pts').slice(1).map(point),width,fill};
    if(type==='text')return {type,text:sx.value(g),at:point(sx.child(g,'at')),angle:Number(sx.value(sx.child(g,'at'),3)||0)};
    throw new Error('暂不支持 AD 符号图元 '+type);
  })}));
  const pads=[],tracks=[],regions=[],texts=[];
  const layerMap={1:'TOP',2:'BOTTOM',3:'TOP_OVERLAY',4:'BOTTOM_OVERLAY',5:'TOP_SOLDER',6:'BOTTOM_SOLDER',7:'TOP_PASTE',8:'BOTTOM_PASTE',9:'MECHANICAL_13',10:'MECHANICAL_14',12:'MULTI_LAYER',13:'MECHANICAL_15',14:'MECHANICAL_15',48:'MECHANICAL_15'};
  const ignored=new Set(['DOCTYPE','HEAD','LAYER','LAYER_PHYS','CANVAS','ACTIVE_LAYER','PREFERENCE','ATTR','FONTSTYLE','LINESTYLE']);
  for(const r of part.footprintRows){
    if(ignored.has(r[0]))continue;
    if([49,50,51,52,53,54,55].includes(r[4])){warnings.push('立创工艺辅助图层未导入 AD；使用独立 STEP。');continue;}
    const layer=layerMap[r[0]==='STRING'?r[3]:r[4]];if(!layer)throw new Error(`暂不支持 AD 封装图层 ${r[4]} 的 ${r[0]}`);
    if(r[0]==='PAD'){
      if(![1,2,12].includes(r[4]))throw new Error('AD 焊盘层无效');
      const s=r[10],shape={RECT:'RECTANGLE',ROUND:'CIRCLE',ELLIPSE:'CIRCLE',OVAL:'ROUNDED_RECTANGLE'}[s?.[0]];
      if(!shape)throw new Error('暂不支持 AD 焊盘形状 '+s?.[0]);
      const width=mm(s[1]),height=mm(s[2]??s[1]),hole=r[4]===12?r[9]:null;
      if(width<=0||height<=0)throw new Error('AD 焊盘尺寸无效');
      if(s[3])throw new Error('暂不支持附加参数的 AD 焊盘');
      if(hole&&(!['ROUND','SLOT'].includes(hole[0])||mm(hole[1])<=0))throw new Error('暂不支持 AD 钻孔形状');
      if(r[4]===12&&!hole)throw new Error('通孔焊盘缺少钻孔');
      if(r[4]!==12&&r[9]&&mm(r[9][1])>0.0011)throw new Error('贴片焊盘包含真实钻孔');
      const hx=hole?mm(hole[1]):0,hy=hole?mm(hole[2]??hole[1]):0;
      pads.push({number:String(r[5]??''),x:mm(r[6]),y:mm(r[7]),width,height,angle:Number(r[8]||0),shape,layer,drill:Math.min(hx,hy),slotLength:Math.abs(hx-hy)>0.0001?Math.max(hx,hy):0,slotAngle:Number(hole?.[3]||0)+(hy>hx?90:0),plated:r[4]===12?!!r[15]:false});
    }else if(r[0]==='POLY'){
      const points=pathPoints(r[6],warnings);for(let i=1;i<points.length;i++)tracks.push({layer,start:points[i-1],end:points[i],width:mm(r[5])});
    }else if(r[0]==='FILL'){
      if(r[6]!==0)throw new Error('暂不支持 AD 非实心填充');
      const paths=r[7].map(p=>pathPoints(p,warnings));if(!paths.length||paths.some(p=>p.length<3))throw new Error('AD 填充路径无效');regions.push({layer,paths});
    }else if(r[0]==='STRING')texts.push({layer,text:String(r[6]),at:[mm(r[4]),mm(r[5])],angle:Number(r[10]||0)});
    else throw new Error('暂不支持 AD 封装图元 '+r[0]);
  }
  if(!pads.length)throw new Error('封装没有焊盘');
  const a=new Set(pins.map(p=>p.number)),b=new Set(pads.map(p=>p.number).filter(Boolean));if(a.size!==b.size||[...a].some(n=>!b.has(n)))throw new Error('AD 符号引脚与封装焊盘编号不一致');
  const fields=componentFields(part);
  return {value:fields.value,pins,units,unitCount:symbol.units,pads,tracks,regions,texts,warnings:[...new Set(warnings)],properties:{LCSC:part.id,MPN:fields.mpn,Manufacturer:fields.manufacturer,...(fields.datasheet?{HelpURL:fields.datasheet}:{})},description:part.description,reference:(part.properties.Designator||'U?').replace(/[?\d]/g,'')+'?'};
}
module.exports={geometry};
