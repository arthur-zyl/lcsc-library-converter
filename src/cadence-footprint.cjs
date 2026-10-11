const {createHash}=require('node:crypto');
const q=v=>JSON.stringify(String(v));
const n=v=>{const x=Number(v);if(!Number.isFinite(x))throw new Error('封装坐标无效');return Number(x.toFixed(6));};
const mm=v=>n(n(v)*0.0254);
const xy=(x,y)=>`${n(x)}:${n(y)}`;
const layers={3:'PACKAGE GEOMETRY/SILKSCREEN_TOP',4:'PACKAGE GEOMETRY/SILKSCREEN_BOTTOM',5:'PACKAGE GEOMETRY/SOLDERMASK_TOP',6:'PACKAGE GEOMETRY/SOLDERMASK_BOTTOM',7:'PACKAGE GEOMETRY/PASTEMASK_TOP',8:'PACKAGE GEOMETRY/PASTEMASK_BOTTOM',9:'PACKAGE GEOMETRY/ASSEMBLY_TOP',10:'PACKAGE GEOMETRY/ASSEMBLY_BOTTOM',13:'PACKAGE GEOMETRY/DISPLAY_TOP',14:'PACKAGE GEOMETRY/DISPLAY_TOP',12:'PACKAGE GEOMETRY/DISPLAY_TOP',48:'PACKAGE GEOMETRY/PLACE_BOUND_TOP'};
const {pathPoints}=require('./cadence-paths.cjs');
const {padGeometry,shapeCommands}=require('./cadence-custom-pads.cjs');
function footprint(part,entry,modelName) {
  const warnings=[],pads=[],padDefs=new Map(),shapes=new Map(),lines=[],fills=[];
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
    const geometry=padGeometry(shape,r,warnings),{width,height,kind,shapeName,points}=geometry;
    if(shapeName)shapes.set(shapeName,{name:shapeName,points});
    const through=r[4]===12,hole=through?r[9]:null;
    if(!through&&r[9]&&mm(r[9][1])>0.0011)throw new Error('贴片焊盘包含真实钻孔');
    if(through&&(!hole||hole[0]!=='ROUND'||mm(hole[1])<=0||Math.abs(mm(hole[1])-mm(hole[2]??hole[1]))>0.0001))throw new Error('目前通孔仅支持圆形钻孔');
    const drill=through?mm(hole[1]):0,plated=through?!!r[15]:false,side=r[4]===2?'BOTTOM':'TOP';
    if(through&&drill>=Math.min(width,height)&&plated)throw new Error('钻孔大于焊盘');
    const number=String(r[5]??'');if(/[\t\r\n]/.test(number))throw new Error('引脚编号包含控制字符');
    const px=mm(r[6]),py=mm(r[7]),angle=n(r[8]||0)*Math.PI/180;
    const hx=(Math.abs(Math.cos(angle))*width+Math.abs(Math.sin(angle))*height)/2,hy=(Math.abs(Math.sin(angle))*width+Math.abs(Math.cos(angle))*height)/2;
    const padBounds=points?bounds(points.map(([x,y])=>[px+x*Math.cos(angle)-y*Math.sin(angle),py+x*Math.sin(angle)+y*Math.cos(angle)])):[px-hx,py-hy,px+hx,py+hy];
    const overlaps=f=>padBounds[2]>f.bounds[0]+0.00001 && padBounds[0]<f.bounds[2]-0.00001 && padBounds[3]>f.bounds[1]+0.00001 && padBounds[1]<f.bounds[3]-0.00001;
    const explicitMask=fills.some(f=>f.layerId===(side==='TOP'?5:6) && overlaps(f));
    const explicitPaste=fills.some(f=>f.layerId===(side==='TOP'?7:8) && overlaps(f));
    const data={kind,width,height,...(shapeName?{shapeName,points}:{}),drill,plated,through,side,...(explicitMask?{explicitMask:true}:{}),...(explicitPaste?{explicitPaste:true}:{})},padName='hub_'+createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0,20);
    padDefs.set(padName,data);pads.push({number,x:mm(r[6]),y:mm(r[7]),angle:n(r[8]||0),padName,...data});
  }
  if(!pads.length)throw new Error('封装没有焊盘');
  const commands=['axlDBChangeDesignUnits("millimeters" 4)','axlDBChangeDesignExtents(list(-1000:-1000 1000:1000))','axlSetVariable("padpath" list("."))','axlSetVariable("psmpath" list("."))','axlSetVariable("steppath" list("."))'];
  for(const [name,p] of padDefs) {
    const make=(layer,w=p.width,h=p.height)=>`make_axlPadStackPad(?layer ${q(layer)} ?type 'REGULAR ?figure ${p.shapeName?q(p.shapeName):"'"+p.kind} ?figureSize ${xy(w,h)})`;
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
    if(row[4]===12)warnings.push('多层非焊盘图形作为机械参考轮廓保留在 DISPLAY_TOP；未生成电气铜层。');
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
  return {commands,pads,shapes:[...shapes.values()],padNames:[...padDefs.keys()],warnings:[...new Set(warnings)],lines,fills};
}
function buildScript(commands){return 'procedure(hubBuild()\n'+commands.join('\n')+'\nf=outfile("build.ok")\nfprintf(f "OK\\n")\nclose(f)\n)\nerrset(hubBuild() t)\naxlShell("exit")\n';}
function auditScript(pads,modelName,fills=[]){
  const commands=['axlSetVariable("steppath" list("."))',`unless(length(axlDBGetDesign()->pins)==${pads.length} error("Native pin count mismatch"))`,'f=outfile("audit.tsv")','g=outfile("shape-audit.tsv")'];
  for(const layer of new Set(fills.map(f=>f.layer)))commands.push(`unless(length(axlDBGetShapes(${q(layer)}))==${fills.filter(f=>f.layer===layer).length} error("Native mask shape count mismatch"))`);
  for(const fill of fills) {
    const [x0,y0,x1,y1]=fill.bounds;
    commands.push(`hubShape=car(setof(s axlDBGetShapes(${q(fill.layer)}) abs(difference(xCoord(car(s->bBox)) ${x0}))<0.003 && abs(difference(yCoord(car(s->bBox)) ${y0}))<0.003 && abs(difference(xCoord(cadr(s->bBox)) ${x1}))<0.003 && abs(difference(yCoord(cadr(s->bBox)) ${y1}))<0.003))`,
      `unless(hubShape && length(hubShape->voids)==${fill.paths.length-1} error("Native mask outline or void mismatch"))`);
  }
  const auditedShapes=new Set();
  for(const expected of pads){
    const p=`car(setof(p axlDBGetDesign()->pins ${expected.number?`p->number == ${q(expected.number)}`:'p->isMech'} && abs(difference(xCoord(p->xy) ${expected.x}))<0.001 && abs(difference(yCoord(p->xy) ${expected.y}))<0.001))`;
    commands.push(`p=${p}`,`unless(p error("Missing native pin"))`,`d=p->definition`,`a=axlDBGetPad(d ${q(expected.side)} "REGULAR")`,`unless(a error("Missing native pad"))`,
      `fprintf(f "%s\\t%f\\t%f\\t%f\\t%s\\t%f\\t%f\\t%f\\t%L\\n" ${q(expected.number)} xCoord(p->xy) yCoord(p->xy) p->rotation a->figureName (xCoord(cadr(a->bBox))-xCoord(car(a->bBox))) (yCoord(cadr(a->bBox))-yCoord(car(a->bBox))) d->drillDiameter d->plating)`);
    if(expected.shapeName&&!auditedShapes.has(expected.padName)){auditedShapes.add(expected.padName);commands.push(
      `unless(a->figureName=="SHAPE" && upperCase(a->name)==${q(expected.shapeName.toUpperCase())} error("Native custom shape binding mismatch"))`,
      `foreach(seg axlPathGetPathSegs(car(a->figure)) fprintf(g "%s\\t%f\\t%f\\n" ${q(expected.padName)} xCoord(seg->_endPoint) yCoord(seg->_endPoint)))`);}
    if(expected.explicitPaste && !expected.through)commands.push(`hubMask=axlDBGetPad(p ${q('PIN/PASTEMASK_'+expected.side)} "REGULAR") when(hubMask && hubMask->figureName!="NULL" error("Duplicate default paste opening"))`);
    if(expected.explicitMask && !expected.through)commands.push(`hubMask=axlDBGetPad(p ${q('PIN/SOLDERMASK_'+expected.side)} "REGULAR") when(hubMask && hubMask->figureName!="NULL" error("Duplicate default solder opening"))`);
  }
  commands.push('s=axlStepGet(nil \'primary nil)',`unless(s && s->step_name == ${q(modelName)} error("STEP mapping mismatch"))`,`unless(axlDMFindFile("ALLEGRO_STEP" ${q(modelName)} "r") error("Relative STEP cannot be resolved"))`,'fprintf(f "STEP\\t%s\\t%f\\t%f\\t%f\\t%f\\t%f\\t%f\\n" s->step_name s->offset_x s->offset_y s->offset_z s->rotation_x s->rotation_y s->rotation_z)','close(f)','close(g)');
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
module.exports={shapeCommands,footprint,buildScript,auditScript,checkAudit,pathPoints};
