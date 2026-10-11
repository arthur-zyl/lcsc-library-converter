const q=v=>JSON.stringify(String(v));
const n=v=>{const x=Number(v);if(!Number.isFinite(x))throw new Error('封装坐标无效');return Number(x.toFixed(6));};
const mm=v=>n(n(v)*0.0254);
const xy=(x,y)=>`${n(x)}:${n(y)}`;
function pathPoints(data,warnings) {
  if(!Array.isArray(data)||data.length<2)throw new Error('无效封装路径');
  if(data[0]==='R') {
    const x=mm(data[1]),y=mm(data[2]),w=mm(data[3]),h=mm(data[4]),angle=n(data[5]||0)*Math.PI/180,r=mm(data[6]||0);
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
    else if(tag==='ARC'||tag==='CARC') {
      const angle=n(data[i++])*Math.PI/180,end=[mm(data[i++]),mm(data[i++])],a=pts.at(-1),dx=end[0]-a[0],dy=end[1]-a[1];
      if(Math.abs(angle)<1e-6||Math.abs(angle)>=2*Math.PI)throw new Error('无效封装圆弧');
      const cx=(a[0]+end[0])/2-dy/(2*Math.tan(angle/2)),cy=(a[1]+end[1])/2+dx/(2*Math.tan(angle/2)),r=Math.hypot(a[0]-cx,a[1]-cy),start=Math.atan2(a[1]-cy,a[0]-cx);
      const step=Math.min(Math.PI/64,2*Math.acos(Math.max(-1,1-0.002/Math.max(r,0.002)))),count=Math.ceil(Math.abs(angle)/step);
      if(count>20000)throw new Error('封装圆弧过大');
      for(let j=1;j<=count;j++)pts.push([cx+r*Math.cos(start+angle*j/count),cy+r*Math.sin(start+angle*j/count)]);
      pts[pts.length-1]=end;warnings.push('封装曲线使用误差不超过 0.002 mm 的折线近似。');
    } else if(tag==='C') {
      const a=pts.at(-1),b=[mm(data[i++]),mm(data[i++])],c=[mm(data[i++]),mm(data[i++])],d=[mm(data[i++]),mm(data[i++])];
      const distance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
      const mid=(a,b)=>a.map((v,k)=>(v+b[k])/2);
      function subdivide(a,b,c,d,depth=0){if(Math.max(distance(b,a,d),distance(c,a,d))<=0.002){pts.push(d);return;}if(depth>=20||pts.length>20000)throw new Error('封装贝塞尔曲线过于复杂');const ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),m=mid(abc,bcd);subdivide(a,ab,abc,m,depth+1);subdivide(m,bcd,cd,d,depth+1);}
      subdivide(a,b,c,d);warnings.push('封装曲线使用误差不超过 0.002 mm 的折线近似。');
    } else throw new Error('暂不支持封装路径 '+tag);
  }
  return pts;
}
module.exports={pathPoints,mm,n,xy,q};
