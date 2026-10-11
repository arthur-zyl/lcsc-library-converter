const fs=require('node:fs/promises');
const path=require('node:path');
const JSZip=require('jszip');
async function archive(file) {
  const bytes=await fs.readFile(file); if(bytes.length>25*1024*1024) throw new Error('原始库文件超过 25 MiB');
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  let size=0;for(const file of Object.values(zip.files)) { size+=file._data?.uncompressedSize||0; if(file.unsafeOriginalName && file.unsafeOriginalName!==file.name) throw new Error('库文件包含非法路径'); }
  if(size>100*1024*1024) throw new Error('原始库解压大小超过 100 MiB');return zip;
}
function rows(text,type) {
  const parsed=text.split(/\r?\n/).filter(x=>x.trim()).map((line,index)=>{
    let row;try{row=JSON.parse(line);}catch{throw new Error(`立创库第 ${index+1} 行不是有效 JSON`);}
    if(!Array.isArray(row)||typeof row[0]!=='string')throw new Error('立创库包含无效图元；当前转换器支持专业版 V2 数组源码格式。');return row;
  });
  if(!parsed.some(x=>x[0]==='DOCTYPE' && x[1]===type))throw new Error(`缺少 ${type} 格式声明`);
  return parsed;
}
function source(zip,ext,uuid) {
  const names=Object.keys(zip.files).filter(x=>!zip.files[x].dir&&x.endsWith(ext));
  const selected=uuid ? names.find(x=>path.posix.basename(x,ext)===uuid) : names.length===1 ? names[0] : undefined;
  if(!selected)throw new Error(`无法唯一确定 ${ext} 原始库，拒绝猜选`);return zip.file(selected);
}
async function readComponent(folder) {
  const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
  if(!/^C[1-9]\d*$/.test(manifest.partId))throw new Error('元件编号无效');
  const deviceZip=await archive(path.join(folder,'device.elibz'));
  const deviceJson=JSON.parse(await deviceZip.file('device.json')?.async('string')||'{}');
  const devices=deviceJson.devices||{};
  const candidates=Object.values(devices).filter(x=>x.attributes?.['Supplier Part']===manifest.partId);
  const device=devices[manifest.device?.uuid] || (candidates.length===1 ? candidates[0] : Object.keys(devices).length===1 ? Object.values(devices)[0] : undefined);
  if(!device)throw new Error('无法确定原始器件信息');
  if(device.attributes?.['Supplier Part'] && device.attributes['Supplier Part']!==manifest.partId)throw new Error('器件库与资源编号不匹配');
  const properties={...manifest.device?.raw?.otherProperty,...device.attributes};
  const sym=source(deviceZip,'.esym',properties.Symbol || manifest.device?.raw?.symbolUuid);
  let footprintZip;try{footprintZip=await archive(path.join(folder,'footprint.elibz'));}catch(error){if(error.code!=='ENOENT')throw error;footprintZip=deviceZip;}
  const fp=source(footprintZip,'.efoo',manifest.device?.footprint?.uuid||properties.Footprint);
  const symbolRows=rows(await sym.async('string'),'SYMBOL'),footprintRows=rows(await fp.async('string'),'FOOTPRINT');
  return {id:manifest.partId,name:properties['Manufacturer Part']||device.display_title||manifest.device?.name||manifest.partId,
    description:device.description||manifest.device?.raw?.description||'',properties,manifest,
    symbolRows,footprintRows,footprintTitle:footprintRows.find(x=>x[0]==='HEAD')?.[1]?.title||'Footprint',
    model:path.join(folder,manifest.partId+'_mount_z0.step'),folder};
}
module.exports={readComponent,rows,archive};
