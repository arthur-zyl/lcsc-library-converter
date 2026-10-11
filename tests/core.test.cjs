const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs/promises');
const os = require('node:os'); const path = require('node:path'); const { once } = require('node:events');
const { component, Store } = require('../src/store.cjs'); const { Bridge } = require('../src/bridge.cjs'); const { WebSocket } = require('ws');
const { processZip, indexResources } = require('../src/resources.cjs');
const { paths,saveSettings } = require('../src/settings.cjs');
const { parseDetails } = require('../src/product-details.cjs');
test('actual C5137636 public detail HTML yields model, image, brand, package and product summary', async () => {
  const html = await fs.readFile(path.join(__dirname, 'fixtures/C5137636.html'), 'utf8');
  const part = component(parseDetails(html, 'C5137636', 'https://item.szlcsc.com/5747088.html'));
  assert.equal(part.name, 'FCC0603B104K500CT'); assert.equal(part.brand, 'FOJAN(富捷)'); assert.equal(part.package, '0603');
  assert.match(part.summary, /100nF.*50V/); assert.match(part.image, /D54186307007C279DD29FE209F8629BF/); assert.ok(part.description.length > 100);
  assert.equal(part.stock, 1041800);
  assert.equal(part.parameters.length, 5); assert.deepEqual(part.parameters[2], { name: '额定电压', value: '50V' }); assert.equal(part.packSize, '4000个/圆盘');
  assert.throws(() => parseDetails(html, 'C123', 'https://item.szlcsc.com/5747088.html'), /匹配/);
});
test('component IDs and product links are validated', () => {
  assert.equal(component({ id: 'c5205141', url: 'https://item.szlcsc.com/123.html' }).id, 'C5205141');
  for (const id of ['../C123', 'C0', 'C123;rm']) assert.throws(() => component({ id }));
  for (const url of ['file:///C:/secret', 'https://szlcsc.com.evil.example/item']) assert.throws(() => component({ id: 'C123', url }));
});
test('queue persists, deduplicates and removes items', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-hub-test-')); const s = await new Store(root).init();
  await Promise.all([s.add({ id: 'C123' }), s.add({ id: 'C123' }), s.add({ id: 'C456' })]);
  assert.equal(s.state.queue.length, 2); const loaded = await new Store(root).init(); assert.equal(loaded.state.queue.length, 2);
  await loaded.remove('C123'); assert.equal((await new Store(root).init()).state.queue[0].id, 'C456');
});
test('bad persisted config is reported rather than silently reset', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-hub-test-')); await fs.writeFile(path.join(root, 'state.json'), '{');
  await assert.rejects(new Store(root).init(), /读取失败/);
});
test('app restart retains queue and completion removes only successful IDs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-hub-cart-')); const s = await new Store(root).init();
  await s.add({ id: 'C123' }); s.state.resources = [{ id: 'C999', folder: 'existing-resource' }]; s.state.freecadPython = 'chosen.exe'; await s.persist();
  const fresh = await new Store(root).init(); assert.deepEqual(fresh.state.queue.map(x=>x.id), ['C123']);
  assert.equal(fresh.state.resources[0].id, 'C999'); assert.equal(fresh.state.freecadPython, 'chosen.exe');
  await fresh.add({ id: 'C123' }); await fresh.add({ id: 'C456' }); await fresh.removeMany(['C123']);
  assert.deepEqual(fresh.state.queue.map(x => x.id), ['C456']);
  assert.deepEqual((await new Store(root).init()).state.queue.map(x=>x.id), ['C456']);
  await fresh.clearQueue();
  assert.deepEqual((await new Store(root).init()).state.queue, []);
});
test('cart metadata is preserved and duplicate detail capture enriches a manual ID', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-hub-cart-')); const s = await new Store(root).init();
  await s.add({ id: 'C123' }); await s.add({ id: 'C123', name: 'Model', brand: 'Brand', package: 'SOT-23', parameters: [{name:'功率',value:'0.5W'}], packSize:'100个/包', image: 'https://alimg.szlcsc.com/upload/public/product/test.jpg' });
  await s.add({ id: 'C123' }); const row = (await new Store(root).init()).state.queue[0];
  assert.equal(row.name, 'Model'); assert.equal(row.brand, 'Brand'); assert.equal(row.package, 'SOT-23'); assert.ok(row.image.endsWith('test.jpg'));
  assert.deepEqual(row.parameters, [{name:'功率',value:'0.5W'}]); assert.equal(row.packSize, '100个/包');
  assert.equal(component({ id: 'C123', image: 'file:///C:/private.png' }).image, '');
  assert.equal(component({ id: 'C123', image: 'https://szlcsc.com.evil.example/p.png' }).image, '');
});

test('settings keep compatible defaults, persist custom paths and reject invalid changes', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-settings-')); const store=await new Store(root).init();
  assert.equal(paths(store).resourceDir,path.join(root,'resources')); assert.equal(paths(store).downloadDir,path.join(root,'downloads'));
  const python=path.join(root,'python.exe'); await fs.writeFile(python,'test fixture');
  const settings={freecadPython:python,resourceDir:path.join(root,'custom library'),downloadDir:path.join(root,'custom downloads')};
  const expected={retainExportPcb:false,...settings,altiumDir:path.join(root,'altium'),altiumLibraryName:'LCSC',altiumFootprintSource:'easyeda',altiumFootprintDir:'',kicadFootprintSource:'easyeda',cadenceFootprintSource:'easyeda',kicadFootprintDir:'',cadenceFootprintDir:'',kicadCli:'',kicadDir:path.join(root,'kicad'),kicadFootprintLibraryName:'LCSC',cadenceRoot:'',cadenceDir:path.join(root,'cadence'),cadenceLibraryName:'LCSC'};
  await saveSettings(store,settings);
  assert.deepEqual(paths(await new Store(root).init({freshQueue:true})),expected);
  assert.deepEqual(await fs.readdir(settings.resourceDir),[]);
  await assert.rejects(saveSettings(store,{...settings,resourceDir:'relative/path'}),/绝对路径/);
  await assert.rejects(saveSettings(store,{...settings,freecadPython:path.join(root,'missing.exe')}),/找不到/);
  await assert.rejects(saveSettings(store,{...settings,downloadDir:python}),/无法写入/);
  await assert.rejects(saveSettings(store,{...settings,kicadFootprintLibraryName:'../invalid'}),/封装库名称/);
  await assert.rejects(saveSettings(store,{...settings,kicadFootprintLibraryName:''}),/封装库名称/);
  assert.deepEqual(paths(store),expected); assert.deepEqual(paths(await new Store(root).init()),expected);
  await assert.rejects(saveSettings(store,{...settings,kicadFootprintSource:'unknown'}),/封装来源/);
  await assert.rejects(saveSettings(store,{...settings,cadenceFootprintDir:'relative'}),/封装库目录/);
  await saveSettings(store,{...settings,kicadFootprintLibraryName:'MyParts'});assert.equal(paths(await new Store(root).init()).kicadFootprintLibraryName,'MyParts');
  await fs.writeFile(path.join(root,'cadence-power-pins.json'),'invalid obsolete config');
  assert.equal(paths(store).cadencePowerRules,undefined);
  await saveSettings(store,settings); // Obsolete rules cannot block settings or exports.

});

test('resource indexing uses the selected library directory and leaves original files in place', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hub-library-')); const store=await new Store(root).init();
  const old=path.join(root,'resources','old.txt'); await fs.mkdir(path.dirname(old),{recursive:true}); await fs.writeFile(old,'keep');
  store.state.resourceDir=path.join(root,'selected library');
  const run=path.join(store.state.resourceDir,'run_test'), folder=path.join(run,'C999'); await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(run,'processing_summary.json'),JSON.stringify([{partId:'C999',status:'extracted'}]));
  await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify({device:{name:'Test part'},createdAt:'test'}));
  await fs.writeFile(path.join(folder,'C999_report.json'),JSON.stringify({mount_translation_mm:[0,0,-1.6]}));
  await fs.writeFile(path.join(folder,'C999_mount_z0.step'),'test fixture');
  const indexed=await indexResources(store); assert.equal(indexed.length,1); assert.equal(indexed[0].folder,folder);
  assert.equal(await fs.readFile(old,'utf8'),'keep'); await fs.access(path.join(folder,'component.json'));
});
test('bridge rejects unauthenticated clients', async t => {
  const bridge = await new Bridge().start(); t.after(() => bridge.close());
  const client = new WebSocket(bridge.uri.replace(bridge.token, 'bad')); client.on('error', () => {});
  await new Promise(resolve => client.once('close', resolve)); assert.equal(bridge.status().connected, false);
});
test('discovery returns connection info only with the embedded EDA credential', async t => {
  const http = require('node:http');
  const bridge = await new Bridge().start(); t.after(() => bridge.close());
  const port = await bridge.startDiscovery(0);
  const request = (headers = {}, method = 'GET', endpoint = '/component-hub/connection') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: endpoint, method, headers }, res => {
      let body = ''; res.on('data', part => body += part); res.on('end', () => resolve({ code: res.statusCode, headers: res.headers, body }));
    }); req.on('error', reject); req.end();
  });
  assert.equal((await request({ Origin: 'https://pro.lceda.cn' })).code, 403);
  assert.equal((await request({ 'X-Component-Hub-Key': 'bad' })).code, 403);
  const headers = { Origin: 'https://pro.lceda.cn', 'X-Component-Hub-Key': bridge.discoveryKey };
  const result = await request(headers); assert.equal(result.code, 200); assert.equal(JSON.parse(result.body).uri, bridge.uri);
  assert.equal(result.headers['access-control-allow-origin'], headers.Origin); assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal((await request(headers, 'OPTIONS')).code, 204);
  assert.equal((await request(headers, 'POST')).code, 405);
  assert.equal((await request(headers, 'GET', '/other')).code, 403);
});
test('bridge sends validated tasks, rejects concurrent exports and correlates replies', async t => {
  const bridge = await new Bridge().start(); t.after(() => bridge.close()); const client = new WebSocket(bridge.uri); await once(client, 'open');
  const incoming = once(client, 'message'); const task = bridge.send(['C123', 'C123', 'C456']);
  const wire = JSON.parse((await incoming)[0]); assert.deepEqual(wire.ids, ['C123', 'C456']); assert.equal(wire.requestId, task.requestId);
  assert.throws(() => bridge.send(['C789']), /已有/);
  client.send(JSON.stringify({ type: 'exported', requestId: 'unrelated' }));
  await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(bridge.active);
  const complete = once(bridge, 'message'); client.send(JSON.stringify({ type: 'exported', requestId: task.requestId, message: 'done' })); await complete;
  assert.equal(bridge.active, null);
  assert.throws(() => bridge.send(['../C123']), /有效/);
});

test('debug retention is sent only to a plugin version that supports it',async t=>{
  const bridge=await new Bridge().start();t.after(()=>bridge.close());const client=new WebSocket(bridge.uri);await once(client,'open');
  assert.throws(()=>bridge.send(['C2915308'],{retainExportPcb:true}),/0\.5\.7/);assert.equal(bridge.active,null);
  let hello=once(bridge,'message');client.send(JSON.stringify({type:'hello',version:'0.5.6',loggedIn:true}));await hello;
  assert.throws(()=>bridge.send(['C2915308'],{retainExportPcb:true}),/0\.5\.7/);
  hello=once(bridge,'message');client.send(JSON.stringify({type:'hello',version:'0.5.7',loggedIn:true}));await hello;
  const incoming=once(client,'message');bridge.send(['C2915308'],{retainExportPcb:true});assert.equal(JSON.parse((await incoming)[0]).retainExportPcb,true);
});
test('real FreeCAD pipeline writes source-only resources and validated independent STEP', { skip: !process.env.HUB_TEST_ZIP }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-hub-real-')); const s = await new Store(root).init();
  s.state.freecadPython = process.env.HUB_FREECAD_PYTHON || 'D:/FreeCAD 1.1/bin/python.exe';
  s.state.resourceDir = path.join(root,'custom library');
  const resources = await processZip(process.env.HUB_TEST_ZIP, s, () => {});
  assert.ok(resources.length); const r = resources[0]; const file = JSON.parse(await fs.readFile(path.join(r.folder, 'component.json'), 'utf8'));
  assert.equal(file.schema, 'eda-component-resource/v0.1'); assert.equal(file.footprint.status, 'source_only');
  assert.equal(file.conversions.cadence, 'not_converted'); assert.ok((await fs.stat(r.model)).size > 100);
  assert.ok(r.folder.startsWith(s.state.resourceDir + path.sep));
  await assert.rejects(fs.access(path.join(root,'resources')));
  const later = await processZip(process.env.HUB_TEST_ZIP, s, () => {});
  assert.equal(later.length, resources.length);
  assert.ok(later.every(item => !resources.some(old => old.folder === item.folder)), 'Completion must identify only this run, never older resources');
});
test('bridge probes login and accepts acknowledgement only for the completed task', async t => {
  const b = await new Bridge().start(); t.after(()=>b.close()); const c = new WebSocket(b.uri); await once(c,'open');
  c.on('message', bytes=>{ const m=JSON.parse(bytes); if(m.type==='check-auth') c.send(JSON.stringify({type:'auth',probeId:m.probeId,loggedIn:true})); });
  assert.equal(await b.checkLogin(),true); assert.equal(b.status().loggedIn,true);
  const task=b.send(['C123']); const finished=once(b,'message'); c.send(JSON.stringify({type:'exported',requestId:task.requestId})); await finished;
  const messages=[]; b.on('message',m=>messages.push(m));
  c.send(JSON.stringify({type:'acknowledged',requestId:'foreign'})); await new Promise(r=>setTimeout(r,20)); assert.equal(messages.length,0);
  const confirmed=once(b,'message'); c.send(JSON.stringify({type:'acknowledged',requestId:task.requestId})); assert.equal((await confirmed)[0].type,'acknowledged');
  c.send(JSON.stringify({type:'acknowledged',requestId:task.requestId})); await new Promise(r=>setTimeout(r,20)); assert.equal(messages.length,1);
});
