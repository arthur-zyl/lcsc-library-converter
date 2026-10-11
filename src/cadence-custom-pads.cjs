const {createHash}=require('node:crypto');
const {pathPoints,mm,n,xy,q}=require('./cadence-paths.cjs');
function outlineBounds(points){return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];}
function area(points){return Math.abs(points.reduce((sum,p,i)=>{const next=points[(i+1)%points.length];return sum+p[0]*next[1]-p[1]*next[0];},0))/2;}
function cleanOutline(input){
  let points=input.map(p=>p.map(n)).filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>0.000001);
  if(points.length>1&&Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<0.000001)points.pop();
  if(points.length<3||points.length>20000||area(points)<0.00000001)throw new Error('自定义焊盘形状为空或退化');
  // Do not let an Allegro repair change a self-intersecting source contour.
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const on=(a,b,p)=>Math.abs(cross(a,b,p))<1e-10&&p[0]>=Math.min(a[0],b[0])-1e-8&&p[0]<=Math.max(a[0],b[0])+1e-8&&p[1]>=Math.min(a[1],b[1])-1e-8&&p[1]<=Math.max(a[1],b[1])+1e-8;
  for(let i=0;i<points.length;i++)for(let j=i+2;j<points.length;j++){
    if(i===0&&j===points.length-1)continue;
    const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];
    if(Math.max(a[0],b[0])<Math.min(c[0],d[0])||Math.max(c[0],d[0])<Math.min(a[0],b[0])||Math.max(a[1],b[1])<Math.min(c[1],d[1])||Math.max(c[1],d[1])<Math.min(a[1],b[1]))continue;
    if((cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))throw new Error('自定义焊盘轮廓自相交');
  }
  points.push([...points[0]]);return points;
}
function padGeometry(shape,row,warnings){
  if(!Array.isArray(shape))throw new Error('缺少焊盘形状');
  const type=shape[0];let points,width,height,kind;
  if(type==='POLY'||type==='POLYGON'){
    const paths=Array.isArray(shape[1]?.[0])?shape[1]:[shape[1]];
    if(paths.length!==1)throw new Error('自定义焊盘包含内孔或多个轮廓；Allegro 形状符号不支持，未填实或合并（引脚 '+row[5]+'）。');
    if(!Array.isArray(paths[0]))throw new Error('自定义焊盘形状路径无效');
    // Serialized Pro pad contours use footprint coordinates before the pad's
    // own rotation. Subtract the anchor; apply row[8] only at pin placement.
    points=pathPoints(paths[0],warnings).map(([x,y])=>[x-mm(row[6]),y-mm(row[7])]);
  }else if(type==='NGON'){
    const diameter=mm(shape[1]),sides=n(shape[2]);
    if(diameter<=0||!Number.isInteger(sides)||sides<3||sides>1024)throw new Error('正多边形焊盘形状参数无效');
    points=Array.from({length:sides},(_,i)=>[diameter/2*Math.cos(2*Math.PI*i/sides),diameter/2*Math.sin(2*Math.PI*i/sides)]);
  }else{
    if(!['RECT','ROUND','ELLIPSE','OVAL'].includes(type))throw new Error('暂不支持焊盘形状 '+type+'（引脚 '+row[5]+'）。');
    width=mm(shape[1]);height=mm(shape[2]??shape[1]);
    if(width<=0||height<=0)throw new Error('焊盘尺寸无效');
    if(type==='RECT'&&shape[3]){
      const ratio=n(shape[3])/100;if(ratio<=0||ratio>0.5)throw new Error('圆角焊盘半径比例无效');
      const radius=Math.min(width,height)*ratio;
      points=pathPoints(['R',-width/2/0.0254,height/2/0.0254,width/0.0254,height/0.0254,0,radius/0.0254],warnings);
    }else if(type==='ELLIPSE'&&Math.abs(width-height)>0.0001){
      const count=Math.ceil(2*Math.PI/Math.min(Math.PI/64,2*Math.acos(Math.max(-1,1-0.002/(Math.max(width,height)/2)))));
      if(count>20000)throw new Error('椭圆焊盘过大');
      const segments=Math.ceil(count/4)*4;points=Array.from({length:segments},(_,i)=>[width/2*Math.cos(2*Math.PI*i/segments),height/2*Math.sin(2*Math.PI*i/segments)]);
      warnings.push('封装曲线使用误差不超过 0.002 mm 的折线近似。');
    }else{
      if(shape[3])throw new Error('焊盘形状包含未支持的附加参数');
      kind={RECT:width===height?'SQUARE':'RECTANGLE',ROUND:'CIRCLE',ELLIPSE:'CIRCLE',OVAL:width>=height?'OBLONG_X':'OBLONG_Y'}[type];
      if(kind==='CIRCLE'&&Math.abs(width-height)>0.0001)throw new Error('非圆形 ROUND 焊盘');
      return {width,height,kind};
    }
  }
  points=cleanOutline(points);const bounds=outlineBounds(points);
  width=n(bounds[2]-bounds[0]);height=n(bounds[3]-bounds[1]);
  const shapeName='hub_shape_'+createHash('sha256').update(JSON.stringify(points)).digest('hex').slice(0,20);
  warnings.push('异形焊盘使用独立 Allegro 形状符号；随库保存 .ssm 文件。');
  return {kind:'SHAPE',shapeName,points,width,height};
}
function shapeCommands(shape){return [
  'axlDBChangeDesignUnits("millimeters" 4)','axlDBChangeDesignExtents(list(-1000:-1000 1000:1000))',
  `hubShape=axlDBCreateOpenShape(axlPathStart(list(${shape.points.map(p=>xy(...p)).join(' ')})) t "ETCH/TOP" nil)`,
  'unless(hubShape error("Custom pad outline creation failed"))',
  'unless(axlDBCreateCloseShape(hubShape) error("Custom pad close failed"))',
  'unless(axlSaveDesign(?noMru t ?noConfirm t) error("Custom pad DRA save failed"))',
  'unless(axlCompileSymbol(?silent t ?silentOnOverwrite t) error("Custom pad SSM compile failed"))'
];}
function checkShapeAudit(text,pads){
  const actual=new Map();for(const line of text.trim().split(/\r?\n/).filter(Boolean)){const [name,x,y]=line.split('\t');if(!actual.has(name))actual.set(name,[]);actual.get(name).push([Number(x),Number(y)]);}
  const layerShapes=pads.flatMap(p=>[...(p.copperLayers||[]),...(p.maskLayers||[]),...(p.pasteLayers||[])].filter(g=>g.shapeName&&!g.suppressed).map(g=>({...g,number:p.number,padName:p.padName+'_'+g.layer})));
  for(const pad of [...pads.filter(p=>p.shapeName),...layerShapes]){
    const points=actual.get(pad.padName);if(!points?.length||points.some(p=>p.some(v=>!Number.isFinite(v))))throw new Error('自定义焊盘轮廓回读失败：'+pad.number);
    // Native coordinates have 0.0001 mm resolution. Check all vertices in both
    // directions and area so wrong handedness/translation/outline cannot pass.
    const near=(a,b)=>a.every(p=>b.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<0.0002));
    if(!near(points,pad.points)||!near(pad.points,points)||Math.abs(area(points)-area(pad.points))>Math.max(0.0002,area(pad.points)*0.0002))throw new Error('自定义焊盘铜轮廓回读不一致：'+pad.number);
  }
}
module.exports={padGeometry,shapeCommands,checkShapeAudit,outlineBounds,area};
