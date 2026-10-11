const {zstdCompressSync,zstdDecompressSync}=require('node:zlib');
const {createHash}=require('node:crypto');
const sx=require('./sexpr.cjs');
function embedModel(text,id,bytes) {
  const tree=sx.parse(text),filename=id+'.step';
  const model=sx.child(tree,'model');if(!model)throw new Error('封装没有模型引用');
  model[1]=sx.str('kicad-embed://'+filename);
  for(let i=tree.length-1;i>=0;i--)if(sx.name(tree[i])==='embedded_files')tree.splice(i,1);
  const compressed=zstdCompressSync(bytes);
  if(!zstdDecompressSync(compressed).equals(bytes))throw new Error('模型压缩校验失败');
  const checksum=createHash('sha256').update(bytes).digest('hex');
  tree.push([sx.atom('embedded_files'),[sx.atom('file'),[sx.atom('name'),sx.str(filename)],[sx.atom('type'),sx.atom('model')],[sx.atom('data'),sx.atom('|'+compressed.toString('base64')+'|')],[sx.atom('checksum'),sx.str(checksum)]]]);
  return sx.write(tree)+'\n';
}
module.exports={embedModel};
