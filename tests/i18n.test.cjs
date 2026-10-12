const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {localeFromSystem,createI18n}=require('../ui/i18n.js'),catalog=require('../ui/locales/en.js');
test('manual language takes precedence while system remains the default',()=>{
 const {resolveLocale}=require('../ui/i18n.js');
 assert.equal(resolveLocale('en',['zh-CN']),'en');
 assert.equal(resolveLocale('zh-CN',['en-US']),'zh-CN');
 assert.equal(resolveLocale('system',['zh-TW']),'zh-CN');
 assert.equal(resolveLocale(undefined,['en-US']),'en');
});
test('system language chooses Chinese variants and English fallback',()=>{
 for(const value of ['zh-CN','zh-TW','zh_HK','zh-Hans'])assert.equal(localeFromSystem(value),'zh-CN');
 for(const value of ['en-US','en-GB','de-DE','ja-JP',undefined])assert.equal(localeFromSystem(value),'en');
 assert.equal(localeFromSystem(['en-US','zh-CN']),'en');
});
test('localized templates preserve values and translate nested progress stages',()=>{
 const en=createI18n('en'),zh=createI18n('zh-CN');
 assert.equal(en.t('确定清空清单中的 {0} 个元件吗？',3),'Clear all 3 components from the export list?');
 assert.equal(zh.t('确定清空清单中的 {0} 个元件吗？',3),'确定清空清单中的 3 个元件吗？');
 assert.equal(en.t('{0} 个元件',1),'1 component');assert.equal(en.t('{0} 个元件',2),'2 components');
 assert.equal(en.t('第 2/4 批 · 提取独立模型'),'Batch 2/4 · Extracting standalone model');
 assert.equal(en.t('KiCad：成功 1，未完成 2。\n目标元件库已保存到设置的固定目录。'),'KiCad: 1 succeeded, 2 incomplete.\nLibraries were saved to the configured output folder.');
 assert.equal(en.t('雄和远景 SMTSO3030CTJ'),'雄和远景 SMTSO3030CTJ');
 assert.equal(en.t('Missing STEP model: C123'),'Missing STEP model: C123');
 assert.equal(en.t('Native name {0}'),'Native name {0}');
});
test('all static and dynamic UI message keys have English translations',()=>{
 const ts=require('typescript'),root=path.resolve(__dirname,'..'),missing=[];
 for(const file of ['app.js','setup.js','eda-lock.js','export-result.js']){
  const tree=ts.createSourceFile(file,fs.readFileSync(path.join(root,'ui',file),'utf8'),ts.ScriptTarget.Latest,true);
  function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(tree)==='t'&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0])&&!Object.hasOwn(catalog,n.arguments[0].text))missing.push(n.arguments[0].text);ts.forEachChild(n,visit);}visit(tree);
 }
 for(const file of ['index.html','eda-lock.html','export-result.html'])for(const m of fs.readFileSync(path.join(root,'ui',file),'utf8').matchAll(/data-i18n(?:-title|-aria-label|-placeholder)?="([^"]*)"/g)){
  const key=m[1].replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&amp;','&');if(!Object.hasOwn(catalog,key))missing.push(key);
 }
 assert.deepEqual(missing,[]);assert.ok(Object.keys(catalog).length>200);
});
