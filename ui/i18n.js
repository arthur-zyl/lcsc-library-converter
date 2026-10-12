(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./locales/en.js'));
  else root.i18n=factory(root.englishMessages).createI18n(root.navigator.languages?.[0]||root.navigator.language);
})(globalThis,function(messages){
  function localeFromSystem(value){const first=Array.isArray(value)?value[0]:value;return /^zh(?:[-_]|$)/i.test(first||'')?'zh-CN':'en';}
  function resolveLocale(preference,system){return ['zh-CN','en'].includes(preference)?preference:localeFromSystem(system);}
  const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const patterns=Object.entries(messages).filter(([key])=>/\{\d+\}/.test(key)).map(([key,en])=>{
    const indexes=[];let cursor=0,source='';
    for(const match of key.matchAll(/\{(\d+)\}/g)){source+=escape(key.slice(cursor,match.index))+'([\\s\\S]*?)';indexes.push(Number(match[1]));cursor=match.index+match[0].length;}
    return {regex:new RegExp('^'+source+escape(key.slice(cursor))+'$'),en,indexes,key};
  }).sort((a,b)=>b.key.length-a.key.length);
  const format=(text,values)=>values.length?text.replace(/\{(\d+)\}/g,(_m,i)=>String(values[i]??'')):text;
  const english=(entry,values)=>typeof entry==='string'?entry:Number(values[entry.count])===1?entry.one:entry.other;
  function createI18n(initial){
    let locale=localeFromSystem(initial);
    function t(key,...values){
      const text=String(key??'');
      if(locale==='zh-CN')return format(text,values);
      if(Object.hasOwn(messages,text))return format(english(messages[text],values),values);
      if(!values.length&&text.includes('\n'))return text.split('\n').map(line=>t(line)).join('\n');
      for(const pattern of patterns){const match=pattern.regex.exec(text);if(match){const args=[];pattern.indexes.forEach((index,i)=>args[index]=t(match[i+1]));return format(english(pattern.en,args),args);}}
      return format(text,values);
    }
    function apply(document){
      if(!document)return;
      document.documentElement.lang=locale;
      for(const node of document.querySelectorAll('[data-i18n]'))node.textContent=t(node.dataset.i18n);
      for(const attr of ['title','aria-label','placeholder'])for(const node of document.querySelectorAll('[data-i18n-'+attr+']'))node.setAttribute(attr,t(node.getAttribute('data-i18n-'+attr)));
    }
    return {t,apply,get locale(){return locale;},setLocale(value,document){const next=localeFromSystem(value);if(next!==locale){locale=next;apply(document);}return locale;}};
  }
  return {localeFromSystem,resolveLocale,createI18n};
});
