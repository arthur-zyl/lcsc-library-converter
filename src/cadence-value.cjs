// Use a conservative ASCII token for the Capture -> Allegro VALUE field.
// Never apply this to descriptions, MPNs, links or another EDA's fields.
function cadenceValue(source) {
  const original=String(source ?? '').trim();
  // Do not normalize superscript exponents/fractions: 10⁻³ must not become 10-3.
  let value=original.replace(/[™®©]/g,'')
    .replace(/[\uFF01-\uFF5E]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/\u3000/g,' ')
    .replace(/[ΩΩ]/g,'')
    .replace(/[µμ]/g,'u')
    .replace(/\+\s*\/\s*-/g,'_pm_').replace(/±/g,'_pm_')
    .replace(/%/g,'pct').replace(/℃/g,'degC').replace(/℉/g,'degF').replace(/°/g,'deg')
    .replace(/[×·]/g,'x').replace(/[÷/]/g,'_per_')
    .replace(/[−–—]/g,'-').replace(/\+/g,'_plus_')
    .replace(/[™®©]/g,'')
    .replace(/[\s,;:()[\]{}]+/g,'_')
    .replace(/_+/g,'_').replace(/^_|_$/g,'');
  // Unknown characters must not silently disappear and change the value.
  const invalid=[...new Set([...value].filter(c=>!/[A-Za-z0-9_.-]/.test(c)))];
  if(!value || invalid.length)throw new Error(`Cadence Value 无法安全转换：${JSON.stringify(original)}${invalid.length?'；未识别字符 '+invalid.map(c=>JSON.stringify(c)+' (U+'+c.codePointAt(0).toString(16).toUpperCase()+')').join('、'):''}。请使用兼容的英文数值/单位。`);
  return {value,warnings:value===original?[]:[`Cadence Value 兼容转换：${original} → ${value}`]};
}
module.exports={cadenceValue};
