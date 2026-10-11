// Minimal S-expression reader/writer for inspecting and updating KiCad libraries.
function parse(input) {
  const tokens = input.match(/"(?:\\.|[^"\\])*"|[()]|[^\s()]+/g) || [];
  let index = 0;
  function read() {
    const token = tokens[index++];
    if (token === '(') { const result=[]; while(tokens[index]!==')') { if(index>=tokens.length) throw new Error('未闭合的 KiCad 表达式'); result.push(read()); } index++; return result; }
    if (!token || token===')') throw new Error('无效的 KiCad 表达式');
    return {value:token.startsWith('"') ? JSON.parse(token) : token, quoted:token.startsWith('"')};
  }
  const result=read(); if(index!==tokens.length) throw new Error('KiCad 文件包含额外表达式'); return result;
}
const atom=value=>({value:String(value),quoted:false});
const str=value=>({value:String(value),quoted:true});
const name=node=>Array.isArray(node) ? node[0]?.value : undefined;
const children=(node,key)=>node.filter(x=>name(x)===key);
const child=(node,key)=>children(node,key)[0];
const value=(node,index=1)=>node?.[index]?.value;
function write(node,depth=0) {
  if(!Array.isArray(node)) return node.quoted ? JSON.stringify(node.value) : node.value;
  if(node.every(x=>!Array.isArray(x))) return '('+node.map(x=>write(x)).join(' ')+')';
  let result='('; for(let i=0;i<node.length;i++) result+=(i ? Array.isArray(node[i]) ? '\n'+'  '.repeat(depth+1) : ' ' : '')+write(node[i],depth+1);
  return result+')';
}
module.exports={parse,write,atom,str,name,child,children,value};
