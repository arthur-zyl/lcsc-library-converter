import { build } from 'esbuild'; import fs from 'node:fs/promises'; import JSZip from 'jszip';
const base = 'extensions/easyeda/';
await build({ entryPoints: [base + 'src/main.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: 'edaEsbuildExportName', outfile: base + 'dist/index.js' });
// A test bundle exposes legacy helpers for regression coverage, never plugin menus.
await build({ entryPoints: ['src/easyeda/runtime.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: 'edaEsbuildExportName', outfile: 'tests/dist/workflow.js' });
const manifest = JSON.parse(await fs.readFile(base + 'extension.json', 'utf8')); const zip = new JSZip();
for (const name of ['extension.json', 'dist/index.js', 'images/logo.png', 'LICENSE']) zip.file(name, await fs.readFile(base + name));
await fs.mkdir('dist', { recursive: true }); await fs.writeFile(`dist/${manifest.name}_v${manifest.version}.eext`, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log('Built EasyEDA bridge extension ' + manifest.version);
