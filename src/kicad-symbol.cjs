const quote=value=>JSON.stringify(String(value??''));
const number=value=>{const n=Number(value);if(!Number.isFinite(n))throw new Error('符号包含无效坐标');return Number(n.toFixed(6));};
const mm=value=>number(number(value)*0.254);
function convertSymbol(part,entry,library,footprintEntry=entry) {
  const units=[];let current;const warnings=[];
  const head=part.symbolRows.find(x=>x[0]==='HEAD')?.[1]||{};
  const ox=number(head.originX||0),oy=number(head.originY||0);
  const point=(x,y)=>`${mm(number(x)-ox)} ${mm(number(y)-oy)}`;
  const styles=new Map(),fonts=new Map();
  for(const r of part.symbolRows){if(r[0]==='PART')break;if(r[0]==='LINESTYLE')styles.set(r[1],r);if(r[0]==='FONTSTYLE')fonts.set(r[1],r);}
  for(const row of part.symbolRows) {
    if(row[0]==='PART'){current={rows:[],bbox:row[2]?.BBOX};units.push(current);}
    else if(current)current.rows.push(row);
    else if(!['DOCTYPE','HEAD','FONTSTYLE','LINESTYLE'].includes(row[0]))throw new Error('符号图元不属于任何 PART');
  }
  if(!units.length)throw new Error('符号没有 PART');
  const pins=[];
  let activeStyles=styles,activeFonts=fonts;
  const stroke=id=>{const style=activeStyles.get(id);return `(stroke (width ${mm(style?.[5]||1)}) (type ${['default','dash','dot','dash_dot'][style?.[3]]||'default'}))`;};
  const fill=id=>`(fill (type ${activeStyles.get(id)?.[4] ? /^#?(fff|ffffff)$/i.test(activeStyles.get(id)[4]) ? 'background' : 'outline' : 'none'}))`;
  const poly=(points,id,closed=false)=>{
    if(points.length<4||points.length%2)throw new Error('符号多边形坐标无效');
    const pairs=[];for(let i=0;i<points.length;i+=2)pairs.push(`(xy ${point(points[i],points[i+1])})`);
    if(closed && pairs[0]!==pairs.at(-1))pairs.push(pairs[0]);
    return `(polyline (pts ${pairs.join(' ')}) ${stroke(id)} ${closed ? fill(id) : '(fill (type none))'})`;
  };
  const electrical={IN:'input',INPUT:'input',OUT:'output',OUTPUT:'output',IO:'bidirectional',BIDIRECTIONAL:'bidirectional',PASSIVE:'passive',POWER:'power_in',POWER_IN:'power_in',POWER_OUT:'power_out',PWR:'power_in',OPENCOLLECTOR:'open_collector',OPEN_COLLECTOR:'open_collector',OPENEMITTER:'open_emitter',OPEN_EMITTER:'open_emitter',TRISTATE:'tri_state',TRI_STATE:'tri_state',NOCONNECT:'no_connect',NO_CONNECT:'no_connect',UNDEFINED:'unspecified'};
  let unspecified=0;
  const bodies=units.map((unit,index)=>{
    activeStyles=new Map(styles);activeFonts=new Map(fonts);
    for(const r of unit.rows){if(r[0]==='LINESTYLE')activeStyles.set(r[1],r);if(r[0]==='FONTSTYLE')activeFonts.set(r[1],r);}
    const attrs=new Map();for(const r of unit.rows)if(r[0]==='ATTR' && r[2]){if(!attrs.has(r[2]))attrs.set(r[2],{});attrs.get(r[2])[r[3]]=r;}
    const graphics=[];
    for(const r of unit.rows) {
      switch(r[0]) {
        case 'ATTR':case 'FONTSTYLE':case 'LINESTYLE':break;
        case 'PIN': {
          const a=attrs.get(r[1])||{},pinNumber=String(a.NUMBER?.[4]??a['Pin Number']?.[4]??'');
          if(!pinNumber)throw new Error('符号引脚没有编号');
          const rawType=String(a['Pin Type']?.[4]||'Undefined').toUpperCase().replace(/[ -]/g,'_');
          const type=electrical[rawType]||'unspecified';if(type==='unspecified')unspecified++;
          const pinName=String(a.NAME?.[4]??a['Pin Name']?.[4]??pinNumber),angle=((number(r[7])%360)+360)%360;
          if(![0,90,180,270].includes(angle))throw new Error('KiCad 符号仅支持正交引脚方向');
          const style=r[9]===2 ? 'inverted' : r[9]===3 ? 'clock' : r[9]===4 ? 'inverted_clock' : 'line';
          pins.push({number:pinNumber,name:pinName,unit:index+1,x:mm(number(r[4])-ox),y:mm(number(r[5])-oy),length:mm(r[6]),angle,type,nameVisible:(a.NAME||a['Pin Name'])?.[6]!==0,numberVisible:(a.NUMBER||a['Pin Number'])?.[6]!==0});
          graphics.push(`(pin ${type} ${style} (at ${point(r[4],r[5])} ${angle}) (length ${mm(r[6])}) (name ${quote(pinName)} (effects (font (size 1.016 1.016)))) (number ${quote(pinNumber)} (effects (font (size 1.016 1.016)))))`);break;
        }
        case 'RECT': {
          if(r[6]||r[7]||r[8])throw new Error('暂不支持带圆角或旋转的符号矩形');
          graphics.push(`(rectangle (start ${point(r[2],r[3])}) (end ${point(r[4],r[5])}) ${stroke(r[9])} ${fill(r[9])})`);break;
        }
        case 'CIRCLE':graphics.push(`(circle (center ${point(r[2],r[3])}) (radius ${mm(r[4])}) ${stroke(r[5])} ${fill(r[5])})`);break;
        case 'ARC':graphics.push(`(arc (start ${point(r[2],r[3])}) (mid ${point(r[4],r[5])}) (end ${point(r[6],r[7])}) ${stroke(r[8])} ${fill(r[8])})`);break;
        case 'POLY':graphics.push(poly(r[2],r[4],!!r[3]));break;
        case 'BEZIER': {
          if(r[2]?.length!==8)throw new Error('无效的符号 Bezier 曲线');
          const pts=[];for(let i=0;i<8;i+=2)pts.push(`(xy ${point(r[2][i],r[2][i+1])})`);
          graphics.push(`(bezier (pts ${pts.join(' ')}) ${stroke(r[3])} ${fill(r[3])})`);break;
        }
        case 'ELLIPSE': {
          if(r[4]===r[5])graphics.push(`(circle (center ${point(r[2],r[3])}) (radius ${mm(r[4])}) ${stroke(r[7])} ${fill(r[7])})`);
          else {const pts=[],angle=number(r[6])*Math.PI/180;for(let i=0;i<=72;i++){const a=i*2*Math.PI/72,x=number(r[4])*Math.cos(a),y=number(r[5])*Math.sin(a);pts.push(number(r[2])+x*Math.cos(angle)-y*Math.sin(angle),number(r[3])+x*Math.sin(angle)+y*Math.cos(angle));}graphics.push(poly(pts,r[7],true));warnings.push('非圆椭圆使用 72 段折线近似。');}break;
        }
        case 'TEXT': {
          const size=mm(activeFonts.get(r[6])?.[5]||5);
          graphics.push(`(text ${quote(r[5])} (at ${point(r[2],r[3])} ${number(r[4])}) (effects (font (size ${size} ${size}))))`);break;
        }
        default:throw new Error(`暂不支持符号图元 ${r[0]}，未生成不完整符号`);
      }
    }
    return `(symbol ${quote(entry+'_'+(index+1)+'_1')} ${graphics.join('\n')})`;
  });
  if(!pins.length)throw new Error('符号没有引脚');
  if(unspecified)warnings.push(`${unspecified} 个引脚的电气类型为原库未定义/未识别，保持 unspecified，需核查 ERC 类型。`);
  const rootAttrs=units[0].rows.filter(r=>r[0]==='ATTR'&&!r[2]);
  const ref=(part.properties.Designator||rootAttrs.find(x=>x[3]==='Designator')?.[4]||'U?').replace(/[?\d]/g,'')||'U';
  const extent=Math.max(...pins.map(p=>p.y))+2.54;
  const property=(key,value,y,hidden=false)=>`(property ${quote(key)} ${quote(value)} (at 0 ${number(y)} 0) (effects (font (size 1.27 1.27))${hidden ? ' hide' : ''}))`;
  const props=[property('Reference',ref,extent),property('Value',part.name,extent+2.54),property('Footprint',library+':'+footprintEntry,0,true),property('Datasheet',part.properties.Datasheet||'',0,true),property('LCSC',part.id,0,true),property('Manufacturer',part.properties.Manufacturer||'',0,true),property('MPN',part.properties['Manufacturer Part']||part.name,0,true),property('ki_description',part.description,0,true)];
  return {text:`(symbol ${quote(entry)} ${pins.every(p=>!p.numberVisible) ? '(pin_numbers hide)' : ''} (pin_names (offset 0.508)${pins.every(p=>!p.nameVisible) ? ' hide' : ''}) (in_bom yes) (on_board yes) ${props.join('\n')} ${bodies.join('\n')})`,pins,units:units.length,warnings};
}
module.exports={convertSymbol,quote,mm};
