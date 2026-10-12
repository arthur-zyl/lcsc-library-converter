import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='win32'||process.arch!=='x64')throw new Error('请在 Windows x64 环境构建。');
async function run(args,executable=process.execPath){await new Promise((resolve,reject)=>{
 const child=spawn(executable,args,{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'}});
 child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('构建失败，退出码 '+code)));
});}
// Fail rather than distributing an app with silently missing AD support.
for(const name of ['altium_monkey','freetype','lxml','lz4','PIL','uharfbuzz','geometer']){
 try{await fs.access(path.join(root,'tools/ad_vendor',name));}
 catch{throw new Error('缺少 AD 转换依赖 '+name+'。请先按 README 使用 FreeCAD Python 安装 tools/requirements-ad.txt。');}
}
await run(['node_modules/typescript/bin/tsc','-p','extensions/easyeda/tsconfig.json','--noEmit','--incremental','false']);
await run(['scripts/build-extension.mjs']);
await run(['node_modules/electron-builder/out/cli/cli.js','--config','electron-builder.cjs','--win',
 ...(process.argv.includes('--dir')?['dir']:['nsis','zip']),'--x64','--publish','never']);
await run(['scripts/verify-package.mjs']);
console.log('Windows 分发文件：'+path.join(root,'release'));
