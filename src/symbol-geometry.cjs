// EasyEDA Pro v2.2: RECT radiusX/radiusY are indices 6/7; rotation (8) is about point 1.
const finite=v=>{const n=Number(v);if(!Number.isFinite(n))throw new Error('符号图形坐标无效');return n;};
function segments(radius,tolerance=0.002/0.254){
 const count=radius?Math.ceil((Math.PI/2)/(2*Math.acos(Math.max(-1,1-tolerance/radius)))):1;
 if(!Number.isFinite(count) || count>4096)throw new Error('符号曲线尺寸过大');return Math.max(1,count);
}
function rectanglePoints(row){
 const [x1,y1,x2,y2,rx,ry,rotation]=row.slice(2,9).map(v=>finite(v??0));
 const left=Math.min(x1,x2),right=Math.max(x1,x2),bottom=Math.min(y1,y2),top=Math.max(y1,y2);
 if(left===right || bottom===top || rx<0 || ry<0)throw new Error('符号矩形尺寸或圆角无效');
 if(rx>(right-left)/2 || ry>(top-bottom)/2)throw new Error('符号矩形圆角超过边长的一半');
 const points=[];
 if(rx && ry){const count=segments(Math.max(rx,ry));for(const [cx,cy,start] of [[right-rx,top-ry,0],[left+rx,top-ry,90],[left+rx,bottom+ry,180],[right-rx,bottom+ry,270]])for(let i=0;i<=count;i++){const a=(start+i*90/count)*Math.PI/180;points.push([cx+rx*Math.cos(a),cy+ry*Math.sin(a)]);}}
 else points.push([left,bottom],[right,bottom],[right,top],[left,top]);
 const angle=rotation*Math.PI/180;
 return points.flatMap(([x,y])=>[x1+(x-x1)*Math.cos(angle)-(y-y1)*Math.sin(angle),y1+(x-x1)*Math.sin(angle)+(y-y1)*Math.cos(angle)]);
}
function ellipsePoints(x,y,rx,ry,rotation){
 [x,y,rx,ry,rotation]=[x,y,rx,ry,rotation].map(v=>finite(v??0));if(rx<=0 || ry<=0)throw new Error('符号椭圆半径无效');
 const count=4*segments(Math.max(rx,ry)),angle=rotation*Math.PI/180,points=[];
 for(let i=0;i<count;i++){const a=i*2*Math.PI/count,dx=rx*Math.cos(a),dy=ry*Math.sin(a);points.push(x+dx*Math.cos(angle)-dy*Math.sin(angle),y+dx*Math.sin(angle)+dy*Math.cos(angle));}return points;
}
module.exports={rectanglePoints,ellipsePoints};
