import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {userDownloadNames} from './release-files.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),release=path.join(root,'release');
const appRoot=path.join(release,'win-unpacked/resources/app');
const extension=JSON.parse(await fs.readFile(path.join(root,'extensions/easyeda/extension.json'),'utf8'));
for(const relative of ['src/main.cjs','src/browser-language.cjs','src/browser-language-preload.cjs','ui/index.html','ui/i18n.js','ui/locales/en.js','tools/process_download.py','tools/extract_easyeda_step.py',
 'tools/capture_convert.tcl','tools/capture_check.py','tools/altium_convert.py','tools/step_bounds.py',
 `dist/${extension.name}_v${extension.version}.eext`,'node_modules/ws/package.json','node_modules/jszip/package.json',
 ...['altium_monkey','freetype','lxml','lz4','PIL','uharfbuzz','geometer'].map(n=>'tools/ad_vendor/'+n)])await fs.access(path.join(appRoot,relative));
for(const relative of ['data','tests','.git','.env','node_modules/electron-builder']){
 if(await fs.stat(path.join(appRoot,relative)).catch(()=>null))throw new Error('不应打入分发包的内容：'+relative);
}
await new Promise((resolve,reject)=>{
 const child=spawn(path.join(release,'win-unpacked/LCSC-Library-Converter.exe'),['--smoke'],{windowsHide:true,cwd:release,stdio:'inherit'});
 const timer=setTimeout(()=>{child.kill();reject(new Error('打包程序启动验证超时'));},45000);
 child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('打包程序启动失败 '+code));});
});
const sums=[];
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
for(const name of userDownloadNames(version)){
 if(!(await fs.stat(path.join(release,name)).catch(()=>null)))continue;
 const hash=createHash('sha256');for await(const chunk of createReadStream(path.join(release,name)))hash.update(chunk);
 sums.push(hash.digest('hex')+'  '+name);
}
await fs.writeFile(path.join(release,'SHA256SUMS.txt'),sums.join('\n')+'\n');
console.log('PACKAGE_VERIFY_OK resources, bundled dependencies, no personal data, EXE startup');
