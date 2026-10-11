function libraryName(value='LCSC') {
  const name=String(value).trim();
  if(!/^[\p{L}\p{N}_][\p{L}\p{N}_.-]{0,79}$/u.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name.endsWith('.'))throw new Error('封装库名称需为 1–80 个字母、数字、汉字、下划线、短横线或点，不能包含空格、冒号或路径符号。');
  return name;
}
function entryName(value) {
  const name=String(value||'').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim().slice(0,150).replace(/[. ]+$/g,'');
  if(!name || /^\.+$/.test(name))throw new Error('原始元件或封装缺少有效名称');
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)?'_'+name:name;
}
function uniqueName(base,id,owners,qualifier) {
  const owner=name=>[...owners].find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1];
  const name=entryName(base);
  if(owner(name)===undefined||owner(name)===id)return name;
  const qualified=entryName(name+'_'+entryName(qualifier));
  if(owner(qualified)===undefined||owner(qualified)===id)return qualified;
  return entryName(qualified+'_'+require('node:crypto').createHash('sha256').update(id).digest('hex').slice(0,8));
}
module.exports={libraryName,entryName,uniqueName};
