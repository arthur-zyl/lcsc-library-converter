const {createHash}=require('node:crypto');
const q=v=>JSON.stringify(String(v));
const n=v=>{const x=Number(v);if(!Number.isFinite(x))throw new Error('封装坐标无效');return Number(x.toFixed(6));};
const mm=v=>n(n(v)*0.0254);
const xy=(x,y)=>`${n(x)}:${n(y)}`;
const layers={3:'PACKAGE GEOMETRY/SILKSCREEN_TOP',4:'PACKAGE GEOMETRY/SILKSCREEN_BOTTOM',5:'PACKAGE GEOMETRY/SOLDERMASK_TOP',6:'PACKAGE GEOMETRY/SOLDERMASK_BOTTOM',7:'PACKAGE GEOMETRY/PASTEMASK_TOP',8:'PACKAGE GEOMETRY/PASTEMASK_BOTTOM',9:'PACKAGE GEOMETRY/ASSEMBLY_TOP',10:'PACKAGE GEOMETRY/ASSEMBLY_BOTTOM',13:'PACKAGE GEOMETRY/DISPLAY_TOP',14:'PACKAGE GEOMETRY/DISPLAY_TOP',48:'PACKAGE GEOMETRY/PLACE_BOUND_TOP'};
function pathPoints(data,warnings) {
  if(data[0]==='R') {
    const x=mm(data[1]),y=mm(data[2]),w=mm(data[3]),h=mm(data[4]),angle=n(data[5]||0)*Math.PI/180,r=mm(data[7]||0);
    if(w<=0 || h<=0 || r<0 || r>Math.min(w,h)/2)throw new Error('无效封装矩形');
    const local=[];
    if(r) {
      const count=Math.ceil((Math.PI/2)/Math.min(Math.PI/64,2*Math.acos(Math.max(-1,1-0.002/r))));
      if(count>20000)throw new Error('封装圆角过大');
      for(const [cx,cy,start] of [[w-r,-r,Math.PI/2],[w-r,-h+r,0],[r,-h+r,-Math.PI/2],[r,-r,-Math.PI]])
        for(let i=0;i<=count;i++){const a=start-i*Math.PI/2/count;local.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]);}
      warnings.push('封装曲线使用误差不超过 0.002 mm 的折线近似。');
    } else local.push([0,0],[w,0],[w,-h],[0,-h]);
    const pts=local.map(([dx,dy])=>[n(x+dx*Math.cos(angle)-dy*Math.sin(angle)),n(y+dx*Math.sin(angle)+dy*Math.cos(angle))]);
    pts.push([...pts[0]]);return pts;
  }
  if(data[0]==='CIRCLE') {const cx=mm(data[1]),cy=mm(data[2]),r=mm(data[3]);if(r<=0)throw new Error('无效封装圆');const step=Math.min(Math.PI/64,2*Math.acos(Math.max(-1,1-0.002/r))),count=Math.ceil(2*Math.PI/step);if(count>20000)throw new Error('封装圆过大');warnings.push('封装曲线使用误差不超过 0.002 mm 的折线近似。');return Array.from({length:count+1},(_,i)=>[cx+r*Math.cos(i*2*Math.PI/count),cy+r*Math.sin(i*2*Math.PI/count)]);}
  const pts=[[mm(data[0]),mm(data[1])]];let i=2;
  while(i<data.length) {
    const tag=data[i++];
    if(tag==='L'){while(i<data.length&&typeof data[i]==='number'){pts.push([mm(data[i]),mm(data[i+1])]);i+=2;}}
    else if(tag==='ARC') {
      const angle=n(data[i++])*Math.PI/180,end=[mm(data[i++]),mm(data[i++])],a=pts.at(-1),dx=end[0]-a[0],dy=end[1]-a[1];
      if(Math.abs(angle)<1e-6||Math.abs(angle)>=2*Math.PI)throw new Error('无效封装圆弧');
      const cx=(a[0]+end[0])/2-dy/(2*Math.tan(angle/2)),cy=(a[1]+end[1])/2+dx/(2*Math.tan(angle/2)),r=Math.hypot(a[0]-cx,a[1]-cy),start=Math.atan2(a[1]-cy,a[0]-cx);
      const step=Math.min(Math.PI/64,2*Math.acos(Math.max(-1,1-0.002/Math.max(r,0.002)))),count=Math.ceil(Math.abs(angle)/step);
      if(count>20000)throw new Error('封装圆弧过大');
      for(let j=1;j<=count;j++)pts.push([cx+r*Math.cos(start+angle*j/count),cy+r*Math.sin(start+angle*j/count)]);
      pts[pts.length-1]=end;warnings.push('封装曲线使用误差不超过 0.002 mm 的折线近似。');
    } else throw new Error('暂不支持封装路径 '+tag);
  }
  return pts;
}
function footprint(part,entry,modelName) {
  const warnings=[],pads=[],padDefs=new Map(),lines=[],fills=[];
  const bounds=pts=>[Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];
  for(const row of part.footprintRows.filter(r=>r[0]==='FILL' && [5,6,7,8].includes(r[4]))) {
    if(row[6]!==0)throw new Error('暂不支持工艺层非实心填充');
    if(!row[7]?.length)throw new Error('工艺层填充路径为空');
    const paths=row[7].map(data=>{const pts=pathPoints(data,warnings);if(pts.length<3)throw new Error('工艺层填充路径无效');if(pts[0][0]!==pts.at(-1)[0] || pts[0][1]!==pts.at(-1)[1])pts.push([...pts[0]]);return pts;});
    fills.push({id:row[1],layer:layers[row[4]],layerId:row[4],paths,bounds:bounds(paths[0])});
  }
  for(const r of part.footprintRows.filter(r=>r[0]==='PAD')) {
    if(![1,2,12].includes(r[4]))throw new Error('不支持焊盘层 '+r[4]);
    const shape=r[10];
    if(!shape)throw new Error('缺少焊盘形状');
    const width=mm(shape[1]),height=mm(shape[2]??shape[1]);if(width<=0||height<=0)throw new Error('焊盘尺寸无效');
    const kind={RECT:width===height?'SQUARE':'RECTANGLE',ROUND:'CIRCLE',ELLIPSE:'CIRCLE',OVAL:width>=height?'OBLONG_X':'OBLONG_Y'}[shape[0]];
    if(!kind)throw new Error('暂不支持焊盘形状 '+shape[0]);
    if(shape[3])throw new Error('暂不支持带圆角/附加参数的焊盘形状');
    if(kind==='CIRCLE'&&Math.abs(width-height)>0.0001)throw new Error('非圆形 ROUND 焊盘');
    const through=r[4]===12,hole=through?r[9]:null;
    if(!through&&r[9]&&mm(r[9][1])>0.0011)throw new Error('贴片焊盘包含真实钻孔');
    if(through&&(!hole||hole[0]!=='ROUND'||mm(hole[1])<=0||Math.abs(mm(hole[1])-mm(hole[2]??hole[1]))>0.0001))throw new Error('目前通孔仅支持圆形钻孔');
    const drill=through?mm(hole[1]):0,plated=through?!!r[15]:false,side=r[4]===2?'BOTTOM':'TOP';
    if(through&&drill>=Math.min(width,height)&&plated)throw new Error('钻孔大于焊盘');
    const number=String(r[5]??'');if(/[\t\r\n]/.test(number))throw new Error('引脚编号包含控制字符');
    const px=mm(r[6]),py=mm(r[7]),angle=n(r[8]||0)*Math.PI/180;
    const hx=(Math.abs(Math.cos(angle))*width+Math.abs(Math.sin(angle))*height)/2,hy=(Math.abs(Math.sin(angle))*width+Math.abs(Math.cos(angle))*height)/2;
    const overlaps=f=>px+hx>f.bounds[0]+0.00001 && px-hx<f.bounds[2]-0.00001 && py+hy>f.bounds[1]+0.00001 && py-hy<f.bounds[3]-0.00001;
    const explicitMask=fills.some(f=>f.layerId===(side==='TOP'?5:6) && overlaps(f));
    const explicitPaste=fills.some(f=>f.layerId===(side==='TOP'?7:8) && overlaps(f));
    const data={kind,width,height,drill,plated,through,side,...(explicitMask?{explicitMask:true}:{}),...(explicitPaste?{explicitPaste:true}:{})},padName='hub_'+createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0,20);
    padDefs.set(padName,data);pads.push({number,x:mm(r[6]),y:mm(r[7]),angle:n(r[8]||0),padName,...data});
  }
  if(!pads.length)throw new Error('封装没有焊盘');
  const commands=['axlDBChangeDesignUnits("millimeters" 4)','axlDBChangeDesignExtents(list(-1000:-1000 1000:1000))','axlSetVariable("padpath" list("."))','axlSetVariable("steppath" list("."))'];
  for(const [name,p] of padDefs) {
    const make=(layer,w=p.width,h=p.height)=>`make_axlPadStackPad(?layer ${q(layer)} ?type 'REGULAR ?figure '${p.kind} ?figureSize ${xy(w,h)})`;
    const copper=p.through?['TOP','DEFAULT INTERNAL','BOTTOM']:[p.side];
    const mask=p.through?['SOLDERMASK_TOP','SOLDERMASK_BOTTOM']:p.explicitMask?[]:['SOLDERMASK_'+p.side];
    const figures=[...copper.map(l=>make(l)),...mask.map(l=>make(l))];if(!p.through && !p.explicitPaste)figures.push(make('PASTEMASK_'+p.side));
    if(!p.through)for(const [explicit,layer] of [[p.explicitPaste,'PASTEMASK_'+p.side],[p.explicitMask,'SOLDERMASK_'+p.side]])if(explicit)figures.push(`make_axlPadStackPad(?layer ${q(layer)} ?type 'REGULAR ?figure 'NULL ?figureSize 0:0)`);
    const drill=p.through?`make_axlPadStackDrill(?holeType 'CIRCLE_DRILL ?drillDiameter ${p.drill} ?plating '${p.plated?'PLATED':'NON_PLATED'} ?figure 'CIRCLE ?figureSize ${xy(p.drill,p.drill)})`:'nil';
    commands.push(`unless(axlDBCreatePadStack(${q(name)} ${drill} list(${figures.join(' ')}) t) error("Padstack creation failed"))`,`unless(axlPadstackToDisk(${q(name)}) error("Padstack save failed"))`);
  }
  for(const p of pads)commands.push(`unless(axlDBCreatePin(${q(p.padName)} ${xy(p.x,p.y)} ${p.number?`make_axlPinText(?number ${q(p.number)} ?offset 0:0 ?text make_axlTextOrientation(?textBlock 1 ?justify "center"))`:'nil'} ${p.angle}) error("Pin creation failed"))`);
  for(const fill of fills) {
    const path=pts=>`axlPathStart(list(${pts.map(p=>xy(...p)).join(' ')}))`;
    commands.push(`hubShape=axlDBCreateOpenShape(${path(fill.paths[0])} t ${q(fill.layer)} nil)`,`unless(hubShape error("Mask shape creation failed"))`);
    for(const hole of fill.paths.slice(1))commands.push(`unless(axlDBCreateVoid(hubShape ${path(hole)}) error("Mask void creation failed"))`);
    commands.push('unless(axlDBCreateCloseShape(hubShape) error("Mask shape close failed"))');
  }
  if(fills.length)warnings.push('保留立创阻焊/锡膏层实心开口及内孔；对应贴片焊盘不再叠加默认开口。');
  const ignored=new Set(['DOCTYPE','HEAD','LAYER','LAYER_PHYS','CANVAS','ACTIVE_LAYER','PREFERENCE','ATTR','FONTSTYLE','LINESTYLE','PAD']);
  for(const row of part.footprintRows) {
    if(ignored.has(row[0]))continue;
    if(row[0]==='FILL' && [5,6,7,8].includes(row[4]))continue;
    if(row[0]==='STRING') {
      const layer=layers[row[3]];if(!layer)throw new Error('暂不支持封装文字层 '+row[3]);
      commands.push(`unless(axlDBCreateText(${q(row[6])} ${xy(mm(row[4]),mm(row[5]))} make_axlTextOrientation(?textBlock 1 ?rotation ${n(row[10]||0)} ?justify "center") ${q(layer)}) error("Text creation failed"))`);
      warnings.push('封装文字保留位置和内容，使用 Allegro 默认字号。');continue;
    }
    if([49,50,51,52,53,54,55].includes(row[4])){warnings.push('立创工艺与 3D 辅助图层未用于 Allegro；独立 STEP 已绑定。');continue;}
    const layer=layers[row[4]];if(!layer)throw new Error(`暂不支持封装图层 ${row[4]} 的 ${row[0]} 图形`);
    if(row[0]==='POLY'||row[0]==='FILL') {
      const paths=row[0]==='POLY'?[row[6]]:row[7];
      for(const data of paths){const pts=pathPoints(data,warnings);lines.push({layer,points:pts});
        commands.push(`unless(axlDBCreateLine(list(${pts.map(p=>xy(...p)).join(' ')}) ${row[0]==='POLY'?mm(row[5]):0.005} ${q(layer)}) error("Geometry creation failed"))`);
        if(row[0]==='FILL')warnings.push('文档层填充图形转换为轮廓。');
      }
    } else throw new Error('暂不支持封装图元 '+row[0]);
  }
  commands.push(`unless(axlDBCreateText("REF" 0:10 make_axlTextOrientation(?textBlock 1 ?justify "center") "REF DES/SILKSCREEN_TOP") error("Reference text failed"))`,
    `unless(axlStepSet('primary nil ${q(modelName)} '(offset_x 0 offset_y 0 offset_z 0 rotation_x 0 rotation_y 0 rotation_z 0 color 0)) error("STEP binding failed"))`,
    'unless(axlSaveDesign(?noMru t ?noConfirm t) error("DRA save failed"))','unless(axlCompileSymbol(?silent t ?silentOnOverwrite t) error("PSM compile failed"))');
  warnings.push('未显式绘制的阻焊和钢网开口暂采用铜焊盘尺寸；未添加负片内层热焊盘，请按板厂规则复核。');
  return {commands,pads,padNames:[...padDefs.keys()],warnings:[...new Set(warnings)],lines,fills};
}
function buildScript(commands){return 'procedure(hubBuild()\n'+commands.join('\n')+'\nf=outfile("build.ok")\nfprintf(f "OK\\n")\nclose(f)\n)\nerrset(hubBuild() t)\naxlShell("exit")\n';}
function auditScript(pads,modelName,fills=[]){
  const commands=['axlSetVariable("steppath" list("."))',`unless(length(axlDBGetDesign()->pins)==${pads.length} error("Native pin count mismatch"))`,'f=outfile("audit.tsv")'];
  for(const layer of new Set(fills.map(f=>f.layer)))commands.push(`unless(length(axlDBGetShapes(${q(layer)}))==${fills.filter(f=>f.layer===layer).length} error("Native mask shape count mismatch"))`);
  for(const fill of fills) {
    const [x0,y0,x1,y1]=fill.bounds;
    commands.push(`hubShape=car(setof(s axlDBGetShapes(${q(fill.layer)}) abs(difference(xCoord(car(s->bBox)) ${x0}))<0.003 && abs(difference(yCoord(car(s->bBox)) ${y0}))<0.003 && abs(difference(xCoord(cadr(s->bBox)) ${x1}))<0.003 && abs(difference(yCoord(cadr(s->bBox)) ${y1}))<0.003))`,
      `unless(hubShape && length(hubShape->voids)==${fill.paths.length-1} error("Native mask outline or void mismatch"))`);
  }
  for(const expected of pads){
    const p=`car(setof(p axlDBGetDesign()->pins ${expected.number?`p->number == ${q(expected.number)}`:'p->isMech'} && abs(difference(xCoord(p->xy) ${expected.x}))<0.001 && abs(difference(yCoord(p->xy) ${expected.y}))<0.001))`;
    commands.push(`p=${p}`,`unless(p error("Missing native pin"))`,`d=p->definition`,`a=axlDBGetPad(d ${q(expected.side)} "REGULAR")`,`unless(a error("Missing native pad"))`,
      `fprintf(f "%s\\t%f\\t%f\\t%f\\t%s\\t%f\\t%f\\t%f\\t%L\\n" ${q(expected.number)} xCoord(p->xy) yCoord(p->xy) p->rotation a->figureName (xCoord(cadr(a->bBox))-xCoord(car(a->bBox))) (yCoord(cadr(a->bBox))-yCoord(car(a->bBox))) d->drillDiameter d->plating)`);
    if(expected.explicitPaste && !expected.through)commands.push(`hubMask=axlDBGetPad(p ${q('PIN/PASTEMASK_'+expected.side)} "REGULAR") when(hubMask && hubMask->figureName!="NULL" error("Duplicate default paste opening"))`);
    if(expected.explicitMask && !expected.through)commands.push(`hubMask=axlDBGetPad(p ${q('PIN/SOLDERMASK_'+expected.side)} "REGULAR") when(hubMask && hubMask->figureName!="NULL" error("Duplicate default solder opening"))`);
  }
  commands.push('s=axlStepGet(nil \'primary nil)',`unless(s && s->step_name == ${q(modelName)} error("STEP mapping mismatch"))`,`unless(axlDMFindFile("ALLEGRO_STEP" ${q(modelName)} "r") error("Relative STEP cannot be resolved"))`,'fprintf(f "STEP\\t%s\\t%f\\t%f\\t%f\\t%f\\t%f\\t%f\\n" s->step_name s->offset_x s->offset_y s->offset_z s->rotation_x s->rotation_y s->rotation_z)','close(f)');
  return buildScript(commands).replace('"build.ok"','"audit.ok"');
}
function checkAudit(text,pads,modelName,placement={x:0,y:0,angle:0}){
  const rows=text.trim().split(/\r?\n/).map(x=>x.split('\t'));if(rows.length!==pads.length+1)throw new Error('原生焊盘数量回读不一致');
  for(let i=0;i<pads.length;i++) {const p=pads[i],r=rows[i],same=(a,b)=>Math.abs(Number(a)-b)<0.0002;
    if(r[0]!==p.number||!same(r[1],p.x)||!same(r[2],p.y)||!same((Number(r[3])+360)%360,(p.angle+360)%360)||r[4]!==p.kind||!same(r[5],p.width)||!same(r[6],p.height)||!same(r[7],p.drill))throw new Error('原生焊盘位置/形状/尺寸/孔径回读不一致：'+p.number);
    if(p.through&&!(p.plated?/^\"?PLATED\"?$/:/^\"?NON_PLATED\"?$/).test(r[8]))throw new Error('原生焊盘镀孔属性不一致');
  }
  const model=rows.at(-1);if(model[0]!=='STEP'||model[1]!==modelName||model.slice(2).some((x,i)=>(i===5?Math.abs(((Number(x)-placement.angle+540)%360+360)%360-180):Math.abs(Number(x)-[placement.x,placement.y,0,0,0,placement.angle][i]))>0.0002))throw new Error('原生 STEP 相对关联不一致');
}
module.exports={footprint,buildScript,auditScript,checkAudit,pathPoints};
