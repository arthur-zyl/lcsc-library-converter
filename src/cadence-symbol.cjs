const {componentFields}=require('./component-fields.cjs');
const {cadenceValue}=require('./cadence-value.cjs');
// Capture stores symbol coordinates in 10 mil units; Y points down.
const {convertSymbol}=require('./kicad-symbol.cjs');
const sx=require('./sexpr.cjs');
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const def=(tag,attrs={},body='')=>`<${tag}><Defn ${Object.entries(attrs).map(([k,v])=>`${k}="${esc(v)}"`).join(' ')}/>${body}</${tag}>`;
const font=tag=>def(tag,{charset:0,escapement:0,height:-8,italic:0,name:'Arial',orientation:0,weight:400,width:0});
const coord=v=>Math.round(Number(v)/0.254);
// Preserve source electrical types and make display names unique across all units.
function applyPinNames(record) {
  const pins=record.pins.map(p=>({...p}));
  const names=record.pinNameBaseNames || record.pins.map(p=>p.name);
  const types=record.powerPinBaseTypes || record.pins.map(p=>p.type);
  if(names.length!==pins.length||types.length!==pins.length)throw new Error('Capture 原始引脚记录数量不一致。');
  const key=n=>String(n).toUpperCase(),counts=new Map(),reserved=new Set(names.map(key));
  for(const name of names)counts.set(key(name),(counts.get(key(name))||0)+1);
  const groups=new Map(),changes=[];
  for(const name of names)if(counts.get(key(name))>1&&!groups.has(key(name))) {
    const count=counts.get(key(name));let separator='_';
    // Reserve untouched original names as well as every name generated earlier.
    while(Array.from({length:count},(_,i)=>key(name+separator+(i+1))).some(n=>reserved.has(n)))separator+='_';
    const generated=Array.from({length:count},(_,i)=>name+separator+(i+1));
    generated.forEach(n=>reserved.add(key(n)));groups.set(key(name),{generated,index:0});
  }
  pins.forEach((pin,i)=>{const group=groups.get(key(names[i]));pin.name=group?group.generated[group.index++]:names[i];pin.type=types[i];if(pin.name!==record.pins[i].name || pin.type!==record.pins[i].type)changes.push(`${pin.number}: ${record.pins[i].name} → ${pin.name}`);});
  let index=0;
  const xml=record.xml.replace(/<SymbolPinScalar>[\s\S]*?<\/SymbolPinScalar>/g,block=>{
    const pin=pins[index++];if(!pin)throw new Error('Capture 引脚记录与 XML 数量不一致。');
    return block.replace(/(<Defn\s+[^>]*?)\bname="[^"]*"/, (_match,prefix)=>prefix+'name="'+esc(pin.name)+'"').replace(/(<Defn\s+[^>]*?)\btype="[0-9]+"/,(_match,prefix)=>prefix+'type="'+pin.type+'"');
  });
  if(index!==pins.length)throw new Error('Capture 引脚记录与 XML 数量不一致。');
  const warnings=(record.warnings||[]).filter(w=>!w.startsWith('同名非 Power 引脚需核查：')&&!w.startsWith('电源规则更新'));
  if(changes.length)warnings.push('引脚名称/类型更新：'+changes.join('；'));
  return {...record,xml,pins,pinNameBaseNames:names,powerPinBaseTypes:types,warnings:[...new Set(warnings)]};
}
function captureSymbol(part,entry,footprint) {
  const converted=convertSymbol(part,entry,'Cadence',footprint),tree=sx.parse(converted.text),warnings=[...converted.warnings];
  const types={input:0,bidirectional:1,output:2,passive:4,tri_state:3,open_collector:5,open_emitter:6,power_in:7,power_out:7,no_connect:4,unspecified:4};
  if(converted.pins.some(p=>p.type==='unspecified'))warnings.push('Capture 不支持 unspecified，引脚映射为 Passive；请核查 ERC。');
  if(converted.pins.some(p=>p.type==='power_out'))warnings.push('Capture 的 Power 引脚类型不区分电源输入和输出。');
  if(converted.pins.some(p=>[p.x,p.y,p.length].some(v=>Math.abs(coord(v)*0.254-v)>0.00001)))warnings.push('符号坐标按 Capture 的 10 mil 分辨率取整。');
  const fields=componentFields(part);
  const compatibleValue=cadenceValue(fields.value);warnings.push(...compatibleValue.warnings);
  const ref=(part.properties.Designator||'U?').replace(/[?\d]/g,'')||'U';
  const expected=[];
  const point=node=>[coord(sx.value(node)), -coord(sx.value(node,2))];
  const style=node=>({lineStyle:0,lineWidth:Number(sx.value(sx.child(sx.child(node,'stroke')||[],'width')))>0.4?1:0});
  const poly=(pts,st)=>def('Polyline',{...st,startShape:0,endShape:0,arrowHeadSize:0},pts.map(([x,y])=>def('PolylinePoint',{x,y})).join(''));
  const units=sx.children(tree,'symbol').map((unit,index)=>{
    let graphics='';const bounds=[];
    for(const g of unit.slice(2)) {
      const tag=sx.name(g),st=style(g);
      if(tag==='pin')continue;
      if(['rectangle','circle'].includes(tag)) {
        let a,b;
        if(tag==='rectangle'){a=point(sx.child(g,'start'));b=point(sx.child(g,'end'));}
        else{const [x,y]=point(sx.child(g,'center')),r=coord(sx.value(sx.child(g,'radius')));a=[x-r,y-r];b=[x+r,y+r];}
        bounds.push(a,b);graphics+=def(tag==='rectangle'?'Rect':'Ellipse',{...st,fillStyle:1,hatchStyle:0,x1:Math.min(a[0],b[0]),y1:Math.min(a[1],b[1]),x2:Math.max(a[0],b[0]),y2:Math.max(a[1],b[1])});
      } else if(['polyline','bezier'].includes(tag)) {
        const pts=sx.child(g,'pts').slice(1).map(point);bounds.push(...pts);
        graphics+=tag==='polyline'?poly(pts,st):def('Bezier',st,pts.map(([x,y])=>def('BezierPoint',{x,y})).join(''));
      } else if(tag==='arc') {
        // Native arc uses its bounding ellipse and endpoints.
        const [a,m,b]=['start','mid','end'].map(k=>point(sx.child(g,k))),[x1,y1]=a,[x2,y2]=m,[x3,y3]=b;
        const d=2*(x1*(y2-y3)+x2*(y3-y1)+x3*(y1-y2));if(Math.abs(d)<1e-6)throw new Error('符号圆弧退化');
        const q=(x,y)=>x*x+y*y,cx=(q(x1,y1)*(y2-y3)+q(x2,y2)*(y3-y1)+q(x3,y3)*(y1-y2))/d,cy=(q(x1,y1)*(x3-x2)+q(x2,y2)*(x1-x3)+q(x3,y3)*(x2-x1))/d,r=Math.hypot(x1-cx,y1-cy);
        bounds.push([cx-r,cy-r],[cx+r,cy+r]);graphics+=def('Arc',{...st,startX:x1,startY:y1,endX:x3,endY:y3,x1:Math.round(cx-r),x2:Math.round(cx+r),y1:Math.round(cy-r),y2:Math.round(cy+r)});
      } else if(tag==='text') {
        const [x,y]=point(sx.child(g,'at')),name=sx.value(g);graphics+=def('CommentText',{locX:x,locY:y,name,textJustification:0,x1:x,x2:x+name.length*5,y1:y-8,y2:y+2},font('TextFont'));bounds.push([x,y]);
        if(Number(sx.value(sx.child(g,'at'),3)))warnings.push('Capture 注释文字采用水平排布。');
      } else throw new Error('不支持的符号图形 '+tag);
    }
    const pins=converted.pins.filter(p=>p.unit===index+1);let physical='';
    const pinXml=pins.map((p,position)=>{
      const x=coord(p.x),y=-coord(p.y),angle=p.angle*Math.PI/180,startX=x+Math.round(coord(p.length)*Math.cos(angle)),startY=y-Math.round(coord(p.length)*Math.sin(angle));
      const normalized=sx.children(unit,'pin')[position],shape=sx.value(normalized,2);
      const record={number:p.number,name:p.name,unit:index+1,position,hotptX:x,hotptY:y,startX,startY,type:types[p.type]};expected.push(record);bounds.push([x,y],[startX,startY]);
      physical+=def('PinNumber',{number:p.number,position});
      const flags={IsLong:coord(p.length)>=10?1:0,IsClock:shape.includes('clock')?1:0,IsDot:shape.includes('inverted')?1:0,IsLeftPointing:0,IsRightPointing:0,IsNetStyle:0,IsNoConnect:p.type==='no_connect'?1:0,IsGlobal:0,IsNumberVisible:p.numberVisible?1:0};
      return def('SymbolPinScalar',{hotptX:x,hotptY:y,startX,startY,name:p.name,position,type:types[p.type],visible:1},Object.entries(flags).map(([k,v])=>def(k,{val:v})).join(''));
    }).join('');
    const xs=bounds.map(p=>p[0]),ys=bounds.map(p=>p[1]),box={x1:Math.floor(Math.min(...xs)),x2:Math.ceil(Math.max(...xs)),y1:Math.floor(Math.min(...ys)),y2:Math.ceil(Math.max(...ys))};
    const display=name=>def('SymbolDisplayProp',{locX:box.x1,locY:box.y1-(name==='Value'?14:24),name,rotation:0,textJustification:0},font('PropFont')+def('PropColor',{val:48})+def('PropDispType',{ValueIfValueExist:0,val:1}));
    const props={LCSC:part.id,Manufacturer:fields.manufacturer,MPN:fields.mpn,Description:fields.description,Datasheet:fields.datasheet};
    const view=display('Part Reference')+display('Value')+def('SymbolColor',{val:48})+def('SymbolBBox',box)+def('IsPinNumbersVisible',{val:pins.some(p=>p.numberVisible)?1:0})+def('IsPinNamesRotated',{val:1})+def('IsPinNamesVisible',{val:pins.some(p=>p.nameVisible)?1:0})+def('PartValue',{name:compatibleValue.value})+def('Reference',{name:ref})+Object.entries(props).map(([name,val])=>def('SymbolUserProp',{name,val})).join('')+graphics+pinXml;
    return def('LibPart',{CellName:entry+(converted.units>1?'-'+(index+1):'')},def('NormalView',{suffix:'.Normal'},view)+def('PhysicalPart',{},physical));
  }).join('');
  return applyPinNames({xml:def('Package',{alphabeticNumbering:0,isHomogeneous:converted.units===1?1:0,name:entry,pcbFootprint:footprint,pcbLib:'',refdesPrefix:ref},units),pins:expected,units:converted.units,warnings:[...new Set(warnings)]});
}
function libraryXml(name,entries) {return '<?xml version="1.0" encoding="utf-8"?><Lib>'+`<Defn LibraryExportVersion="1.1" name="${esc(name)}"/>`+def('DefaultValues',{},def('DefaultFont',{index:0,charset:0,escapement:0,height:-8,italic:0,name:'Arial',orientation:0,weight:400,width:0}))+entries.map(e=>e.xml).join('')+'</Lib>';}
module.exports={captureSymbol,libraryXml,applyPinNames};
