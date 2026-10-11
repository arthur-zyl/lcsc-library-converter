const fs=require('node:fs'),path=require('node:path');
const BUILTIN='(?:[ADP]?VDD(?:IO|CORE|PLL|OSC|RTC|USB|A|D|P)?|[ADP]?VCC(?:IO|INT|AUX|BRAM|O|PAUX|PINT|PLL|A|D)?|[ADP]?VSS(?:IO|A|D)?|[ADP]?GND(?:A|D)?)(?:_?(?:[0-9]+(?:V[0-9]+)?|[0-9]+\\.[0-9]+V?)|_(?:DDR|MIO[0-9]+)_[0-9]+)?';
const LEGACY_EXCLUDE='.*_(?:EN|ENABLE|SENSE|DETECT|GOOD|PG|MON|MONITOR)(?:_.*)?';
const excluded=['EN','ENABLE','SENSE','DETECT','GOOD','PG','MON','MONITOR'];
const DEFAULT_TEXT='# 每行一个模式；* 任意字符，? 单个字符，! 排除，# 注释\n# 常见电源名称已有内置识别，可在这里补充\nVCCO_*\nVCCINT\nVCCAUX\nVCCBRAM\nVCCPAUX\nVCCPINT\n'+excluded.flatMap(n=>['!*_'+n,'!*_'+n+'_*']).join('\n');
const DEFAULT={format:'glob',patterns:DEFAULT_TEXT};
function validateLegacy(value){
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('电源规则必须是 JSON 对象');
  const result={};
  for(const key of ['extra','exclude']){
    if(!Array.isArray(value[key]) || value[key].length>32)throw new Error(key+' 必须是最多 32 条正则的数组');
    result[key]=value[key].map((pattern,i)=>{
      if(typeof pattern!=='string'||!pattern.trim()||pattern.length>512)throw new Error(`${key} 第 ${i+1} 条规则不能为空且不得超过 512 字符`);
      try{new RegExp('^(?:'+pattern+')$','i');}catch(e){throw new Error(`${key} 第 ${i+1} 条正则无效：${e.message}`);}return pattern;
    });
  }return result;
}
function parseLines(text){
  if(typeof text!=='string'||text.length>20000)throw new Error('匹配规则不能超过 20000 字符');
  const rows=text.split(/\r?\n/),parsed=[];
  if(rows.length>200)throw new Error('匹配规则不能超过 200 行');
  for(const [i,row] of rows.entries()){
    let line=row.trim();if(!line||line.startsWith('#'))continue;
    const exclude=line.startsWith('!');if(exclude)line=line.slice(1).trim();
    if(!line||line.length>200)throw new Error(`第 ${i+1} 行模式不能为空且不得超过 200 字符`);
    const regex='^'+line.split('').map(c=>c==='*'?'.*':c==='?'?'.':c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('')+'$';
    parsed.push({exclude,regex:new RegExp(regex,'i')});
  }return parsed;
}
function migrateLegacy(value){
  const old=validateLegacy(value),lines=[],remaining={extra:[],exclude:[]};
  for(const key of ['extra','exclude'])for(const pattern of old[key]){
    if(key==='exclude'&&pattern===LEGACY_EXCLUDE){lines.push(...excluded.flatMap(n=>['!*_'+n,'!*_'+n+'_*']));continue;}
    const simple=pattern.replace(/\.\*/g,'*');
    if(/^[A-Za-z0-9_*-]+$/.test(simple))lines.push((key==='exclude'?'!':'')+simple);
    else remaining[key].push(pattern);
  }
  return {format:'glob',patterns:lines.join('\n'),...(remaining.extra.length||remaining.exclude.length?{legacy:remaining}:{})};
}
function validateRules(value=DEFAULT){
  if(typeof value==='string')value={format:'glob',patterns:value};
  if(value?.format!=='glob')return migrateLegacy(value);
  parseLines(value.patterns);
  return {format:'glob',patterns:value.patterns,...(value.legacy?{legacy:validateLegacy(value.legacy)}:{})};
}
function matcher(value){
  const rules=validateRules(value),rows=parseLines(rules.patterns),builtin=new RegExp('^(?:'+BUILTIN+')$','i');
  const legacy=rules.legacy,compile=p=>new RegExp('^(?:'+p+')$','i'),extra=(legacy?.extra||[]).map(compile),exclude=(legacy?.exclude||[]).map(compile);
  return name=>{const n=String(name).trim();let match=(builtin.test(n)||extra.some(r=>r.test(n)))&&!exclude.some(r=>r.test(n));for(const row of rows)if(row.regex.test(n))match=!row.exclude;return match;};
}
function rulesPath(store){return path.join(store.root,'cadence-power-pins.json');}
function readRules(store){try{return validateRules(JSON.parse(fs.readFileSync(rulesPath(store),'utf8').replace(/^\uFEFF/,'')));}catch(e){if(e.code==='ENOENT')return validateRules();throw new Error('电源规则配置读取失败：'+e.message);}}
module.exports={BUILTIN,DEFAULT,validateRules,matcher,rulesPath,readRules};
