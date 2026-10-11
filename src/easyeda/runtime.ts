import JSZip from 'jszip';
import { VERSION, documentTypeCode, passiveTab, normalizeId, parseIds, mmFromMil, boardPolygon, assertSingleComponent, assertTopZeroRotation } from './core';

// JSZip's Node entry expects setImmediate, which is not a browser standard.
const scheduler = globalThis as unknown as { setImmediate?: (callback: () => void) => unknown };
if (!scheduler.setImmediate) scheduler.setImmediate = callback => Promise.resolve().then(callback);

type Device = { id: string; uuid: string; libraryUuid: string; name: string;
  footprint?: { uuid: string; libraryUuid: string; name?: string };
  model3D?: { uuid: string; libraryUuid: string; name?: string }; raw: unknown };
type Manifest = { schema: string; extensionVersion: string; partId: string;
  createdAt: string; device?: Device; placement?: Record<string, unknown>; modelSource?: { kind: 'height_placeholder' | 'real'; placeholder: boolean };
  artifacts: Record<string, { status: string; message?: string }>; warnings: string[] };
type PlacedComponent = { documentUuid: string; primitiveId: string };
let busy = false;
let scratch: { uuid: string; tabId: string; owned: boolean; name?: string } | undefined;
let stopRequested = false;
let batchProgress = '';
const TITLE = '立创器件下载';
const EXPORT_PROJECT = 'lcsc-cadence-downloader';
let exportProjectUuid: string | undefined;
const log: Array<{ time: string; stage: string; message: string }> = [];
let bridgeUri = '';
let bridgeRequestId = '';
let exportProgress: { total: number; completed: number; currentId: string; stage: string } | undefined;
function progress(stage: string, completed?: number, currentId?: string): void {
  if (!exportProgress) return;
  exportProgress = { ...exportProgress, stage, completed: completed ?? exportProgress.completed, currentId: currentId ?? exportProgress.currentId };
  notifyDesktop('progress', `${exportProgress.completed}/${exportProgress.total} ${exportProgress.currentId} ${stage}`, { progress: exportProgress });
}
function notifyDesktop(type: string, message: string, extra: Record<string, unknown> = {}): void {
  if (!bridgeUri) return;
  try { eda.sys_WebSocket.send('component-hub', JSON.stringify({ type, requestId: bridgeRequestId, message, ...extra })); }
  catch { /* Keep export operational if the desktop app disconnects. */ }
}
function record(stage: string, message: string): void {
  log.push({ time: new Date().toISOString(), stage, message });
  if (log.length > 100) log.shift();
  if (bridgeRequestId) notifyDesktop('progress', `${stage}: ${message}`);
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function job(action: () => Promise<void>, desktop = false): Promise<void> {
  if (busy) { eda.sys_Dialog.showInformationMessage('已有下载任务运行中，请稍后。', TITLE); return; }
  busy = true;
  try { await action(); }
  catch (error) {
    record('error', errorText(error));
    if (bridgeRequestId) notifyDesktop('failed', errorText(error));
    if (!desktop) eda.sys_Dialog.showInformationMessage(`${errorText(error)}\n\n详细信息可在软件“本地资源 → 连接故障排查”中查看。`, TITLE);
  } finally { busy = false; }
}
function promptId(action: (id: string) => Promise<void>): void {
  eda.sys_Dialog.showInputDialog('输入立创 C 编号', '', TITLE, 'text', 'C48997937', undefined,
    (value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return;
      void job(async () => action(normalizeId(value)));
    });
}
function freshManifest(id: string, device?: Device): Manifest {
  return { schema: 'lcsc-cadence-download/v1', extensionVersion: VERSION, partId: id,
    createdAt: new Date().toISOString(), device, artifacts: {}, warnings: [] };
}
async function currentPcb(): Promise<{ uuid: string; tabId: string }> {
  const info = await eda.dmt_SelectControl.getCurrentDocumentInfo();
  if (!info || info.documentType !== 3) throw new Error('请先切换到 PCB 编辑标签页。');
  return { uuid: info.uuid, tabId: info.tabId };
}
async function ensureDocument(uuid: string): Promise<void> {
  if ((await currentPcb()).uuid !== uuid) throw new Error('操作期间切换了 PCB，请返回原 PCB 重试。');
}
async function lookup(id: string, interactive = true): Promise<Device> {
  record('lookup', id);
  // Resolve the current system library explicitly. The C-number API's implicit
  // default can return an older library (observed in Pro 4.1.71).
  const libraryUuid = await eda.lib_LibrariesList.getSystemLibraryUuid();
  if (!libraryUuid) throw new Error('无法获取立创 EDA 系统库来源，请确认登录后重试。');
  record('lookup-library', JSON.stringify({ partId: id, libraryUuid }));
  let items: Awaited<ReturnType<typeof eda.lib_Device.getByLcscIds>> = [];
  try { items = await eda.lib_Device.getByLcscIds([id], libraryUuid, true); }
  catch (error) { record('lcsc-lookup-failed', `${id}: ${errorText(error)}`); }
  const inLibrary = (item: typeof items[number]) => {
    if (item.libraryUuid === libraryUuid) return true;
    record('lookup-source-rejected', JSON.stringify({ partId: id, uuid: item.uuid, libraryUuid: item.libraryUuid, expectedLibraryUuid: libraryUuid }));
    return false;
  };
  items = items.filter(inLibrary);
  const enrich = async (item: typeof items[number]) => {
    if (item.footprint?.uuid || item.footprintUuid) return item;
    try {
      const full = await eda.lib_Device.get(item.uuid, item.libraryUuid);
      const footprint = full?.association.footprint ?? (full?.association.footprintUuid
        ? { uuid: full.association.footprintUuid, libraryUuid: full.libraryUuid } : undefined);
      if (footprint?.uuid) return { ...item, footprint: { name: '', ...footprint }, footprintUuid: footprint.uuid };
    } catch (error) { record('device-details-failed', `${id}: ${errorText(error)}`); }
    return item;
  };
  items = await Promise.all(items.map(enrich));
  if (!items.some(x => x.footprint?.uuid || x.footprintUuid)) {
    try {
      const alternatives = await eda.lib_Device.search(id, libraryUuid, undefined, undefined, 50, 1);
      const exact = alternatives.filter(inLibrary).filter(x => {
        // New editor builds expose supplierId directly; older type packages
        // only declare the Supplier Part property.
        const supplierId = String((x as typeof x & { supplierId?: string }).supplierId
          ?? x.otherProperty?.['Supplier Part'] ?? '').trim().toUpperCase();
        return supplierId ? supplierId === id : x.name.toUpperCase().endsWith(`_${id}`);
      });
      const enriched = await Promise.all(exact.map(enrich));
      const seen = new Set(items.map(x => `${x.libraryUuid}/${x.uuid}`));
      for (const x of enriched) if (!seen.has(`${x.libraryUuid}/${x.uuid}`)) {
        seen.add(`${x.libraryUuid}/${x.uuid}`); items.push(x);
      }
    } catch (error) { record('alternate-search-failed', `${id}: ${errorText(error)}`); }
  }
  const withFootprint = items.filter(x => x.footprint?.uuid || x.footprintUuid);
  if (withFootprint.length) items = withFootprint;
  record('lookup-candidates', JSON.stringify({ partId: id, libraryUuid, candidates: items.map(x => ({
    uuid: x.uuid, libraryUuid: x.libraryUuid, name: x.name,
    footprintUuid: x.footprint?.uuid ?? x.footprintUuid })) }));
  if (!items.length) throw new Error('系统库未匹配到器件。若器件来自扩展库，请在底部器件库选中该行，再用“下载选中库器件”。');
  let item = items[0];
  if (items.length > 1) {
    if (!interactive) throw new Error('匹配多个器件，批量任务不自动猜选。请用单器件下载入口选择。');
    const choice = await new Promise<string | undefined>((resolve) => {
      eda.sys_Dialog.showSelectDialog(items.map((x, i) => ({ value: String(i),
        displayContent: `${x.name} | ${x.footprint?.name ?? x.footprintName ?? '无封装'} | ${x.uuid.slice(0, 8)}` })),
      `${id} 匹配多个器件，请选择`, '', TITLE, '0', false, resolve);
    });
    if (choice === undefined || !items[Number(choice)]) throw new Error('未选择器件。');
    item = items[Number(choice)];
  }
  const footprint = item.footprint ?? (item.footprintUuid
    ? { uuid: item.footprintUuid, libraryUuid: item.libraryUuid, name: item.footprintName } : undefined);
  const model3D = item.model3D ?? (item.model3DUuid
    ? { uuid: item.model3DUuid, libraryUuid: item.libraryUuid, name: item.model3DName } : undefined);
  record('lookup-selected', JSON.stringify({ partId: id, uuid: item.uuid, libraryUuid: item.libraryUuid,
    name: item.name, footprint, model3D }));
  return { id, uuid: item.uuid, libraryUuid: item.libraryUuid, name: item.name, footprint, model3D, raw: item };
}
async function selectedDevice(id: string): Promise<Device> {
  const selected = await eda.lib_SelectControl.getSelectedLibraryRowInfo();
  if (!selected || selected.libraryType !== '3') throw new Error('请先在底部器件库选中一行器件。');
  const item = await eda.lib_Device.get(selected.uuid, selected.libraryUuid);
  if (!item) throw new Error('无法读取选中器件。扩展库若不支持此 API，请先将器件保存到个人库，再选中个人库中的器件。');
  if (item.property.supplierId && normalizeId(item.property.supplierId) !== id)
    throw new Error(`选中器件编号 ${item.property.supplierId} 与输入 ${id} 不一致。`);
  const footprint = item.association.footprint ?? (item.association.footprintUuid
    ? { uuid: item.association.footprintUuid, libraryUuid: item.libraryUuid } : undefined);
  return { id, uuid: item.uuid, libraryUuid: item.libraryUuid, name: item.name, footprint, raw: item };
}
async function addFile(zip: JSZip, name: string, getFile: () => Promise<File | undefined>, manifest: Manifest): Promise<void> {
  try {
    const file = await getFile();
    if (!file || !file.size) throw new Error('API 未返回文件。');
    zip.file(name, new Uint8Array(await file.arrayBuffer()));
    manifest.artifacts[name] = { status: 'included' };
    record('artifact', name);
  } catch (error) {
    manifest.artifacts[name] = { status: 'failed', message: errorText(error) };
    manifest.warnings.push(`${name}: ${errorText(error)}`);
    record('artifact-failed', `${name}: ${errorText(error)}`);
  }
}
async function addLibraries(zip: JSZip, device: Device, manifest: Manifest): Promise<void> {
  await addFile(zip, 'device.elibz', () => eda.sys_FileManager.getDeviceFileByDeviceUuid(device.uuid, device.libraryUuid, 'elibz'), manifest);
  if (device.footprint) {
    await addFile(zip, 'footprint.elibz', () => eda.sys_FileManager.getFootprintFileByFootprintUuid(
      device.footprint!.uuid, device.footprint!.libraryUuid, 'elibz'), manifest);
  } else manifest.warnings.push('查询未返回封装关联，将尝试通过 PCB 放置解析。');
}
async function savePackage(zip: JSZip, manifest: Manifest): Promise<void> {
  if (!Object.values(manifest.artifacts).some(x => x.status === 'included'))
    throw new Error(`未取得任何模型或库文件。\n${manifest.warnings.join('\n')}`);
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('README.txt', '器件原始库与单器件 PCB STEP 下载包。\n查看 manifest.json 的 artifacts 和 warnings。\n运行配套本地 process_download.py 提取独立模型。\n封装尚未转换为 Cadence 格式。\n');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  await eda.sys_FileSystem.saveFile(blob, `${manifest.partId}_easyeda.zip`);
  eda.sys_Dialog.showInformationMessage(`已发起下载：${manifest.partId}_easyeda.zip\n请在浏览器下载列表确认文件已保存。`
    + (manifest.warnings.length ? `\n\n部分内容未取得：\n${manifest.warnings.join('\n')}` : ''), TITLE);
}
function geometryApis(): Array<{ getAllPrimitiveId: () => Promise<string[]>;
  delete: (ids: string[]) => Promise<boolean> }> {
  return [eda.pcb_PrimitiveComponent, eda.pcb_PrimitivePad, eda.pcb_PrimitiveVia,
    eda.pcb_PrimitiveLine, eda.pcb_PrimitiveArc, eda.pcb_PrimitivePolyline, eda.pcb_PrimitivePour,
    eda.pcb_PrimitiveFill, eda.pcb_PrimitiveRegion, eda.pcb_PrimitiveString,
    eda.pcb_PrimitiveImage, eda.pcb_PrimitiveObject, eda.pcb_PrimitiveDimension,
    eda.pcb_PrimitivePoured, eda.pcb_PrimitiveAttribute];
}
async function emptyPcb(): Promise<{ uuid: string; tabId: string }> {
  const doc = await currentPcb();
  const apis = geometryApis();
  const counts = await Promise.all(apis.map(async api => (await api.getAllPrimitiveId()).length));
  if (counts.some(x => x > 0)) throw new Error('此操作需要全空白 PCB。请新建一个 PCB 编辑页；已有单器件板可使用“导出当前单器件 PCB”。');
  await ensureDocument(doc.uuid);
  return doc;
}
let timerSequence = 0;
async function pauseForPcb(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!eda.sys_Timer.setTimeoutTimer(`lcsc-pcb-${++timerSequence}`, 250, resolve))
      reject(new Error('无法设置 PCB 同步等待定时器。'));
  });
}
async function pcbInfo(uuid: string) {
  const info = await eda.dmt_Pcb.getPcbInfo(uuid);
  return info ?? (await eda.dmt_Pcb.getAllPcbsInfo()).find(x => x.uuid === uuid);
}
async function deleteCreatedPcb(uuid: string): Promise<void> {
  const result = await eda.dmt_Pcb.deletePcb(uuid);
  record('scratch-delete-result', JSON.stringify({ uuid, result }));
  // undefined from getPcbInfo alone can mean lookup failure, not deletion.
  for (let attempt = 0; attempt < 6; attempt++) {
    const remaining = (await eda.dmt_Pcb.getAllPcbsInfo()).some(x => x.uuid === uuid);
    if (result && !remaining) return;
    if (attempt < 5) await pauseForPcb();
  }
  throw new Error(`未能确认临时 PCB 已删除（UUID：${uuid}），请在工程树核对。`);
}
async function prepareProjectSwitch(): Promise<void> {
  const tree = await eda.dmt_EditorControl.getSplitScreenTree();
  if (!tree) throw new Error('无法核对编辑器标签页，未自动切换工程。');
  const collect = (node: typeof tree): Array<NonNullable<typeof tree.tabs>[number]> =>
    [...node.tabs ?? [], ...(node.children ?? []).flatMap(collect)];
  const tabs = collect(tree);
  record('project-switch-tabs', JSON.stringify(tabs.map(x => ({ title: x.title, tabId: x.tabId, type: x.documentType }))));
  const designs = tabs.filter(x => !passiveTab(x.documentType, x.title))
    .map(x => ({ ...x, normalizedType: documentTypeCode(x.documentType) }));
  const unsupported = designs.filter(x => ![1, 3, 26].includes(x.normalizedType ?? NaN));
  if (unsupported.length) throw new Error(`以下库或其他编辑标签页无法自动保存，请先手动保存并关闭：${unsupported.map(x => x.title || x.tabId).join('、')}`);
  const original = await eda.dmt_SelectControl.getCurrentDocumentInfo();
  try {
    for (const tab of designs) {
      const label = tab.title || tab.tabId;
      if (!tab.tabId || !await eda.dmt_EditorControl.activateDocument(tab.tabId))
        throw new Error(`无法激活后台文档“${label}”，未切换工程。`);
      const focused = await eda.dmt_SelectControl.getCurrentDocumentInfo();
      if (focused?.tabId !== tab.tabId || documentTypeCode(focused.documentType) !== tab.normalizedType)
        throw new Error(`后台文档“${label}”焦点核验失败，未切换工程。`);
      const saved = tab.normalizedType === 3 ? await eda.pcb_Document.save()
        : tab.normalizedType === 1 ? await eda.sch_Document.save() : await eda.pnl_Document.save();
      record('project-switch-save', JSON.stringify({ tabId: tab.tabId, type: tab.documentType, saved }));
      if (!saved) throw new Error(`后台文档“${label}”保存失败，未切换工程。请检查权限或连接后重试。`);
    }
  } finally {
    if (original?.tabId && designs.length) {
      try { await eda.dmt_EditorControl.activateDocument(original.tabId); }
      catch (error) { record('restore-tab-failed', errorText(error)); }
    }
  }
}
async function ensureExportProject(): Promise<void> {
  exportProjectUuid = undefined;
  // These "current" APIs need a focused project document. Home has no such context.
  let current: Awaited<ReturnType<typeof eda.dmt_Project.getCurrentProjectInfo>>;
  try {
    const doc = await eda.dmt_SelectControl.getCurrentDocumentInfo();
    if (doc && [1, 3, 26].includes(documentTypeCode(doc.documentType) ?? NaN))
      current = await projectApi('getCurrentProjectInfo', () => eda.dmt_Project.getCurrentProjectInfo());
  } catch (error) { record('current-project-unavailable', errorText(error)); }
  const teams = await projectApi('getAllTeamsInfo', () => eda.dmt_Team.getAllTeamsInfo());
  record('export-team-list', JSON.stringify(teams.map(x => ({ uuid: x.uuid, name: x.name }))));
  const personal = teams.filter(x => ['个人', 'personal'].includes(x.name.trim().toLowerCase()));
  if (personal.length !== 1) throw new Error('无法唯一识别个人空间，未改用其他团队。请下载诊断日志核对个人空间标识。');
  const teamUuid = personal[0].uuid;
  record('export-personal-space', teamUuid);
  const ids = await projectApi('getAllProjectsUuid', () => eda.dmt_Project.getAllProjectsUuid(teamUuid));
  const matches: Array<{ uuid: string; friendlyName: string }> = [];
  for (const uuid of ids) {
    const info = await projectApi('getProjectInfo', () => eda.dmt_Project.getProjectInfo(uuid));
    if (!info) throw new Error(`无法读取工程 ${uuid}，未创建新工程，避免重复。`);
    if (info.friendlyName === EXPORT_PROJECT && info.teamUuid === teamUuid) matches.push(info);
  }
  if (matches.length > 1) throw new Error(`个人空间存在多个 ${EXPORT_PROJECT} 工程，请先整理重名工程。`);
  let uuid: string | undefined = matches[0]?.uuid;
  if (!uuid || current?.uuid !== uuid) await prepareProjectSwitch();
  if (!uuid) {
    record('export-project-create-args', JSON.stringify({ friendlyName: EXPORT_PROJECT, projectName: 'default', team: 'default-personal', folder: 'root' }));
    // Official createProject default is personal; do not pass a team UUID or a fixed link name.
    uuid = await projectApi('createProject', () => eda.dmt_Project.createProject(EXPORT_PROJECT, undefined, undefined,
      undefined, '立创器件下载扩展专用导出工程'));
    record('export-project-create-result', JSON.stringify({ uuid: uuid ?? null }));
    if (!uuid) throw new Error('createProject 未返回工程 UUID（已使用默认个人空间）。API 未提供失败原因，请下载诊断日志核对；此结果不能直接判定为权限不足。');
    record('export-project-created', uuid);
    let ready = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const info = await projectApi('getProjectInfo-after-create', () => eda.dmt_Project.getProjectInfo(uuid!));
      if (info?.uuid === uuid && info.friendlyName === EXPORT_PROJECT) {
        if (info.teamUuid !== teamUuid) throw new Error(`创建的工程不属于已识别的个人空间（UUID：${uuid}），未继续导出。`);
        ready = true; break;
      }
      await pauseForPcb();
    }
    if (!ready) throw new Error(`专用工程尚未同步（UUID：${uuid}），请稍后重试。工程已保留。`);
  }
  if (current?.uuid !== uuid) {
    await prepareProjectSwitch();
    if (!await projectApi('openProject', () => eda.dmt_Project.openProject(uuid!))) throw new Error('专用工程打开失败，未创建 PCB。');
  }
  exportProjectUuid = uuid;
  record('export-project-ready', uuid);
}
async function projectApi<T>(name: string, action: () => Promise<T>): Promise<T> {
  record('project-api-start', name);
  try {
    const value = await action();
    record('project-api-done', name);
    return value;
  } catch (error) {
    const stack = (error as { stack?: string } | undefined)?.stack;
    record('project-api-failed', `${name}: ${stack ?? errorText(error)}`);
    throw new Error(`工程准备失败 [${name}]：${errorText(error)}`);
  }
}
async function createScratch(debugPartId?: string): Promise<void> {
  if (scratch?.owned) throw new Error('已有临时 PCB，请先完成该 PCB 的批量任务，避免重复创建。');
  await ensureExportProject();
  const uuid = await eda.dmt_Pcb.createPcb();
  if (!uuid) throw new Error('无法在专用工程中创建导出 PCB。');
  record('scratch-create-result', uuid);
  const name = `${debugPartId ? 'debug_'+debugPartId : 'temp_lcsc'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const tabId = await eda.dmt_EditorControl.openDocument(uuid);
    if (!tabId) throw new Error('临时 PCB 无法打开。');
    await ensureDocument(uuid);
    let ready = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const info = await pcbInfo(uuid);
      record('scratch-ready', JSON.stringify({ attempt, uuid, info }));
      if (info?.uuid === uuid) {
        if (info.parentProjectUuid !== exportProjectUuid) throw new Error('创建的 PCB 不属于专用工程，已停止。');
        ready = true; break;
      }
      if (attempt < 5) await pauseForPcb();
    }
    if (!ready) throw new Error('新 PCB 尚未在工程树中就绪。');
    let renamed = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      await ensureDocument(uuid);
      try {
        const result = await eda.dmt_Pcb.modifyPcbName(uuid, name);
        record('scratch-rename-result', JSON.stringify({ attempt, uuid, name, result }));
      } catch (error) { record('scratch-rename-error', errorText(error)); }
      const info = await pcbInfo(uuid);
      record('scratch-rename-readback', JSON.stringify({ attempt, info }));
      if (info?.uuid === uuid && info.name === name) { renamed = true; break; }
      if (attempt < 5) await pauseForPcb();
    }
    if (!renamed) throw new Error('临时 PCB 重命名失败（已打开 PCB 并重试 6 次）。');
    await emptyPcb();
    scratch = { uuid, tabId, owned: true, name };
    record('scratch-created', `${uuid}: ${name}`);
  } catch (error) {
    try { await deleteCreatedPcb(uuid); }
    catch (cleanupError) {
      record('scratch-rollback-failed', errorText(cleanupError));
      throw new Error(`${errorText(error)}\n${errorText(cleanupError)}`);
    }
    throw new Error(`${errorText(error)}\n本次创建的 PCB 已删除。`);
  }
}
async function finishScratch(): Promise<{ status: string; message?: string }> {
  if (!scratch?.owned) return { status: 'bound_pcb_retained' };
  const owned = scratch;
  try {
    const info = await pcbInfo(owned.uuid);
    if (!info || info.uuid !== owned.uuid || info.name !== owned.name)
      throw new Error('临时 PCB 名称或身份已变化，未自动删除。');
    await deleteCreatedPcb(owned.uuid);
    scratch = undefined;
    record('scratch-deleted', owned.uuid);
    return { status: 'temporary_pcb_deleted' };
  } catch (error) {
    record('scratch-delete-failed', errorText(error));
    return { status: 'delete_failed', message: errorText(error) };
  }
}
type RetainedPcb = { uuid: string; name?: string; partId: string; saved: boolean; message?: string };
async function retainScratch(partId: string): Promise<RetainedPcb> {
  if (!scratch?.owned) throw new Error('调试模式只能保留本次自动创建的 PCB，请从软件启动导出。');
  const owned=scratch,result:RetainedPcb={uuid:owned.uuid,name:owned.name,partId,saved:false};
  try {
    const info=await pcbInfo(owned.uuid);
    if (!info || info.uuid!==owned.uuid || info.name!==owned.name) throw new Error('调试 PCB 身份或名称已变化，请手动保存检查。');
    await ensureDocument(owned.uuid);
    if (!await eda.pcb_Document.save()) throw new Error('调试 PCB 保存失败，已保留编辑现场，请手动保存。');
    await ensureDocument(owned.uuid);result.saved=true;
  } catch(error) {result.message=errorText(error);}
  // Release ownership so the next task never clears or deletes this snapshot.
  scratch=undefined;record('debug-pcb-retained',JSON.stringify({...result,projectUuid:exportProjectUuid}));
  return result;
}
async function clearScratch(): Promise<void> {
  if (!scratch) throw new Error('未绑定专用导出 PCB。');
  const uuid = scratch.uuid;
  await ensureDocument(uuid);
  // Delete components first, then query remaining geometry: child pads may
  // already be removed together with their parent component.
  for (const api of geometryApis()) {
    await ensureDocument(uuid);
    const ids = await api.getAllPrimitiveId();
    await ensureDocument(uuid);
    if (ids.length && !await api.delete(ids)) throw new Error('专用 PCB 清空失败，批量任务已停止。');
  }
  await ensureDocument(uuid);
  await emptyPcb();
  record('scratch-cleared', uuid);
}
async function place(device: Device): Promise<PlacedComponent> {
  const doc = await emptyPcb();
  const component = await eda.pcb_PrimitiveComponent.create({ uuid: device.uuid, libraryUuid: device.libraryUuid }, 1, 0, 0, 0);
  if (!component) throw new Error('器件放置失败。请检查库来源与封装关联。');
  await ensureDocument(doc.uuid);
  const actualFootprint = component.getState_Footprint();
  if (!actualFootprint?.uuid) throw new Error('已尝试放置，但 PCB 器件仍没有实际封装关联。请使用“选中库器件”入口核对手动使用的库来源。');
  const box = await eda.pcb_Primitive.getPrimitivesBBox([component.getState_PrimitiveId()]);
  if (!box) throw new Error('器件已放置，但未取得边框，请手动画板框后使用“导出当前单器件 PCB”。');
  const polygon = eda.pcb_MathPolygon.createPolygon(boardPolygon(box));
  if (!polygon) throw new Error('板框多边形创建失败。');
  const outline = await eda.pcb_PrimitivePolyline.create('', 11, polygon, 0.1);
  if (!outline) throw new Error('器件已放置，但板框创建失败。请手动画板框后再导出。');
  await ensureDocument(doc.uuid);
  record('placed', `${device.id} at data origin, top, rotation=0`);
  return { documentUuid: doc.uuid, primitiveId: component.getState_PrimitiveId() };
}
async function addPcb(zip: JSZip, manifest: Manifest, placed?: PlacedComponent): Promise<void> {
  const doc = await currentPcb();
  const component = assertSingleComponent(await eda.pcb_PrimitiveComponent.getAll());
  if (placed && (placed.documentUuid !== doc.uuid || placed.primitiveId !== component.getState_PrimitiveId()))
    throw new Error('当前 PCB 或器件图元与本次放置结果不一致。');
  assertTopZeroRotation(component.getState_Layer(), component.getState_Rotation());
  const supplierId = component.getState_SupplierId();
  if (supplierId && normalizeId(supplierId) !== manifest.partId) throw new Error('PCB 器件编号与输入编号不一致。');
  const associated = component.getState_Component();
  // EDA may copy a library device into a project library during placement.
  // Its instance UUID/library UUID can therefore differ from the query source.
  // For automatic placement, verify the exact created primitive and PCB instead.
  const model = component.getState_Model3D();
  manifest.modelSource = { kind: model?.uuid ? 'real' : 'height_placeholder', placeholder: !model?.uuid };
  if (!model?.uuid) {
    manifest.warnings.push('未绑定独立 3D 模型，已启用立创 EDA 根据器件高度自动生成模型。');
    record('model-auto-generated', manifest.partId + ': 使用器件高度自动生成 3D 模型');
  }
  manifest.placement = { documentUuid: doc.uuid, coordinateUnit: 'mil',
    primitiveId: component.getState_PrimitiveId(),
    footprintXMil: component.getState_X(), footprintYMil: component.getState_Y(),
    footprintXMm: mmFromMil(component.getState_X()), footprintYMm: mmFromMil(component.getState_Y()),
    footprintRotationDeg: component.getState_Rotation(), layer: component.getState_Layer(),
    component: associated, footprint: component.getState_Footprint(), model3D: model,
    designator: component.getState_Designator(), supplierId };
  const actualFootprint = component.getState_Footprint();
  if (actualFootprint?.uuid && manifest.artifacts['footprint.elibz']?.status !== 'included') {
    if (manifest.device) manifest.device.footprint = actualFootprint;
    await addFile(zip, 'footprint.elibz', () => eda.sys_FileManager.getFootprintFileByFootprintUuid(
      actualFootprint.uuid, actualFootprint.libraryUuid, 'elibz'), manifest);
    manifest.warnings = manifest.warnings.filter(x => !x.startsWith('查询未返回封装关联'));
  }
  await ensureDocument(doc.uuid);
  await addFile(zip, 'pcb_with_component.step', () => eda.pcb_ManufactureData.get3DFile(
    `${manifest.partId}_pcb.step`, 'step', ['Component Model'], 'Outfit', true), manifest);
  await ensureDocument(doc.uuid);
  try {
    const sources = await eda.sys_FileManager.getDocumentFootprintSources();
    if (sources.length) {
      zip.file('footprint_sources.json', JSON.stringify(sources, null, 2));
      manifest.artifacts['footprint_sources.json'] = { status: 'included' };
    } else {
      manifest.warnings.push('未返回独立封装源码，尝试保留 PCB 文档。');
      await addFile(zip, 'pcb_document.epro', () => eda.sys_FileManager.getDocumentFile(
        `${manifest.partId}_pcb.epro`, undefined, 'epro'), manifest);
    }
  } catch (error) { manifest.warnings.push(`封装源码获取失败：${errorText(error)}`); }
}
async function attemptPcb(zip: JSZip, manifest: Manifest, device: Device): Promise<void> {
  try { const placed = await place(device); await addPcb(zip, manifest, placed); }
  catch (error) {
    manifest.artifacts['pcb_with_component.step'] = { status: 'failed', message: errorText(error) };
    manifest.warnings.push(`STEP 未完成：${errorText(error)}；已放置的器件或板框保留在 PCB，便于手动检查。`);
    record('pcb-failed', errorText(error));
  }
}
async function runBatch(ids: string[], retainExportPcb = false): Promise<void> {
  exportProgress = { total: ids.length, completed: 0, currentId: '', stage: '准备导出工程' };
  progress('准备导出工程');
  stopRequested = false;
  if(retainExportPcb && scratch && !scratch.owned)throw new Error('调试模式请使用软件自动创建的导出 PCB，未清空当前绑定的 PCB。');
  if (!scratch) await createScratch(retainExportPcb ? ids[0] : undefined);
  else {
    await eda.dmt_EditorControl.openDocument(scratch.uuid);
    await ensureDocument(scratch.uuid);
  }
  const outer = new JSZip();
  const results: Array<{ partId: string; status: string; message?: string }> = [];
  let stoppedReason = '';
  const retained: RetainedPcb[] = [];
  for (let index = 0; index < ids.length; index++) {
    if (stopRequested) { stoppedReason = '用户请求停止'; break; }
    const id = ids[index];
    batchProgress = `${index + 1}/${ids.length}：${id}`;
    record('batch-progress', batchProgress);
    progress('清理临时 PCB', index, id);
    const files = outer.folder(id)!;
    const manifest = freshManifest(id);
    try {
      if (!scratch) await createScratch(retainExportPcb ? id : undefined);
      await clearScratch();
    } catch (error) {
      stoppedReason = errorText(error);
      results.push({ partId: id, status: 'failed', message: stoppedReason });
      manifest.warnings.push(stoppedReason);
      files.file('manifest.json', JSON.stringify(manifest, null, 2));
      progress('元件处理失败', results.length);
      break;
    }
    try {
      progress('查找元件');
      const device = await lookup(id, false);
      manifest.device = device;
      progress('下载符号和封装');
      await addLibraries(files, device, manifest);
      progress('放置元件');
      const placed = await place(device);
      progress('导出 STEP 模型');
      await addPcb(files, manifest, placed);
    } catch (error) {
      manifest.warnings.push(errorText(error));
      if (manifest.artifacts['pcb_with_component.step']?.status !== 'included')
        manifest.artifacts['pcb_with_component.step'] = { status: 'failed', message: errorText(error) };
      record('batch-item-failed', `${id}: ${errorText(error)}`);
    }
    // Always clean up the bound PCB, including a partially failed placement.
    // A document switch or failed cleanup stops the queue before another part.
    progress('清理临时 PCB');
    try {
      if (retainExportPcb) {
        progress('保存调试 PCB');
        const saved=await retainScratch(id);retained.push(saved);
        if (!saved.saved) throw new Error(saved.message);
      } else await clearScratch();
    }
    catch (error) { stoppedReason = errorText(error); manifest.warnings.push(stoppedReason); }
    files.file('manifest.json', JSON.stringify(manifest, null, 2));
    const complete = ['device.elibz', 'footprint.elibz', 'pcb_with_component.step']
      .every(name => manifest.artifacts[name]?.status === 'included');
    const any = Object.values(manifest.artifacts).some(x => x.status === 'included');
    results.push({ partId: id, status: complete ? 'complete' : any ? 'partial' : 'failed',
      message: manifest.warnings.join('\n') || undefined });
    progress('元件处理完成', results.length);
    if (stopRequested && !stoppedReason) stoppedReason = '用户请求中止';
    if (stoppedReason) break;
  }
  const done = new Set(results.map(x => x.partId));
  for (const id of ids) if (!done.has(id)) results.push({ partId: id, status: 'not_started' });
  if (retainExportPcb && scratch?.owned) retained.push(await retainScratch(exportProgress?.currentId || ''));
  const scratchDocumentUuid = scratch?.uuid || retained.at(-1)?.uuid;
  progress(retainExportPcb ? '保留调试 PCB' : '删除临时 PCB', results.filter(x => x.status !== 'not_started').length, '');
  const pcbCleanup = retainExportPcb ? {status:'debug_pcbs_retained',projectUuid:exportProjectUuid,documents:retained} : await finishScratch();
  outer.file('batch_manifest.json', JSON.stringify({ schema: 'lcsc-cadence-batch/v1',
    extensionVersion: VERSION, createdAt: new Date().toISOString(), scratchDocumentUuid, pcbCleanup,
    exportProjectUuid: scratch?.owned ? exportProjectUuid : (retainExportPcb || pcbCleanup.status === 'temporary_pcb_deleted' ? exportProjectUuid : undefined),
    requestedIds: ids, stoppedReason: stoppedReason || undefined, results }, null, 2));
  outer.file('README.txt', '每个 C 编号目录内有 manifest.json 及已取得文件。\n'
    + '查看 batch_manifest.json 了解失败和未处理项。\n将整个 ZIP 拖到配套 process_download.cmd 批量提取 STEP。\n');
  batchProgress = `打包 ${results.filter(x => x.status !== 'not_started').length}/${ids.length}`;
  progress('打包导出文件');
  const blob = await outer.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  progress('下载导出文件');
  await eda.sys_FileSystem.saveFile(blob, `LCSC_batch_${stamp}.zip`);
  const count = (status: string) => results.filter(x => x.status === status).length;
  batchProgress = `完整 ${count('complete')}，部分 ${count('partial')}，失败 ${count('failed')}，未开始 ${count('not_started')}`;
  notifyDesktop('exported', batchProgress, { results, stoppedReason, pcbCleanup, fileName: `LCSC_batch_${stamp}.zip` });
  exportProgress = undefined;
}
const DISCOVERY_URL = 'http://127.0.0.1:27361/component-hub/connection';
let autoEnabled = false;
let connectionEpoch = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let discoveryPending: Promise<void> | undefined;
function loggedIn(): boolean {
  try { const user = eda.sys_Environment.getUserInfo(); return !!(user?.uuid || user?.username); } catch { return false; }
}
function openDesktop(uri: string): void {
  if (!loggedIn()) throw new Error('请先登录立创 EDA，再连接软件。');
  if (!/^ws:\/\/127\.0\.0\.1:\d{1,5}\/\?token=[a-f0-9]{48}$/.test(uri)) throw new Error('连接地址无效，请从桌面应用重新复制。');
  if (bridgeUri && bridgeUri !== uri) {
    if (bridgeRequestId) throw new Error('导出中暂不切换连接，请等待当前任务结束。');
    eda.sys_WebSocket.close('component-hub'); bridgeUri = '';
  }
  eda.sys_WebSocket.register('component-hub', uri, event => {
    let message: { retainExportPcb?: unknown; type?: string; requestId?: string; ids?: unknown; probeId?: string };
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.type === 'check-auth') { notifyDesktop('auth', '立创 EDA 登录状态', { loggedIn: loggedIn(), probeId: message.probeId }); return; }
    if (message.type === 'stop' && message.requestId === bridgeRequestId) {
      if (exportProgress && !['删除临时 PCB','保留调试 PCB','打包导出文件','下载导出文件'].includes(exportProgress.stage)) {
        stopRequested = true;
        notifyDesktop('progress', '已收到中止请求，等待当前元件处理和清理完成。');
      }
      return;
    }
    if (message.type !== 'export' || typeof message.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(message.requestId)) return;
    if (busy) { try { eda.sys_WebSocket.send('component-hub', JSON.stringify({ type: 'failed', requestId: message.requestId, message: '立创 EDA 中已有任务运行' })); } catch {} return; }
    void job(async () => {
      bridgeRequestId = message.requestId!;
      try {
        if (!Array.isArray(message.ids) || message.ids.some(x => typeof x !== 'string')) throw new Error('任务器件清单格式错误');
        if (!loggedIn()) throw new Error('请先登录立创 EDA，再导出元件。');
        if (message.retainExportPcb!==undefined && typeof message.retainExportPcb!=='boolean') throw new Error('调试开关格式错误');
        await runBatch(parseIds(message.ids.join(',')), message.retainExportPcb===true);
      } catch (error) { notifyDesktop('failed', errorText(error)); throw error; }
      finally { bridgeRequestId = ''; }
    }, true);
  }, () => { bridgeUri = uri; notifyDesktop('hello', '立创 EDA 扩展连接成功', { loggedIn: loggedIn(), version: VERSION }); });
}
function discoverDesktop(): Promise<void> {
  if (discoveryPending) return discoveryPending;
  const epoch = connectionEpoch;
  discoveryPending = (async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        eda.sys_ClientUrl.request(DISCOVERY_URL, 'GET'),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('自动发现超时，请确认桌面应用正在运行。')), 3000); }),
      ]);
      if (!response.ok) throw new Error('自动发现未获授权。请在桌面应用内嵌的立创 EDA 中使用插件，并开启外部交互权限。');
      const value = await response.json();
      if (value?.schema !== 'component-hub-connection/v1' || typeof value.uri !== 'string') throw new Error('自动发现返回的数据无效。');
      if (epoch === connectionEpoch) openDesktop(value.uri);
    } finally { if (timeout !== undefined) clearTimeout(timeout); }
  })().finally(() => { discoveryPending = undefined; });
  return discoveryPending;
}
async function reconnect(): Promise<void> {
  if (!autoEnabled) return;
  const epoch = connectionEpoch;
  if (bridgeUri && !loggedIn()) { notifyDesktop('auth', '请先登录立创 EDA', { loggedIn: false }); try { eda.sys_WebSocket.close('component-hub'); } catch {} bridgeUri = ''; }
  try { await discoverDesktop(); } catch { /* Startup must not show dialogs or interrupt editing. */ }
  if (autoEnabled && epoch === connectionEpoch) reconnectTimer = setTimeout(() => { void reconnect(); }, 5000);
}
export function connectDesktop(): void {
  if (!autoEnabled) activate();
  void job(async () => {
    await discoverDesktop();
    eda.sys_Dialog.showInformationMessage('已自动发起连接，无需输入地址。请在桌面应用查看“立创 EDA 插件已连接”。', TITLE);
  });
}
export function connectDesktopManual(): void {
  eda.sys_Dialog.showInputDialog('粘贴桌面应用复制的连接地址', '需开启扩展的外部交互权限；地址仅用于本机连接。', TITLE,
    'text', '', undefined, (value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return;
      void job(async () => {
        const uri = value.trim();
        autoEnabled = false; connectionEpoch++; if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
        openDesktop(uri);
        eda.sys_Dialog.showInformationMessage('已发起桌面连接，请在应用中查看连接状态。', TITLE);
      });
    });
}
export function activate(): void { if (autoEnabled) return; autoEnabled = true; void reconnect(); }
export function deactivate(): void { autoEnabled = false; connectionEpoch++; if (reconnectTimer !== undefined) clearTimeout(reconnectTimer); try { eda.sys_WebSocket.close('component-hub'); } catch {} bridgeUri = ''; }
export function createExportPcb(): void {
  void job(async () => {
    await createScratch();
    eda.sys_Dialog.showInformationMessage(`已创建 ${scratch?.name}。批量结束后会自动删除。`, TITLE);
  });
}
export function bindExportPcb(): void {
  void job(async () => {
    scratch = { ...await currentPcb(), owned: false };
    record('scratch-bound', scratch.uuid);
    eda.sys_Dialog.showInformationMessage(`已绑定当前 PCB：${scratch.uuid}\n批量任务会自动清空此 PCB 的器件、板框及其他图元。`, TITLE);
  });
}
export function batchDownload(): void {
  eda.sys_Dialog.showInputDialog('输入多个 C 编号，用空格、逗号或分号分隔（每批最多 50 个）。',
    '自动查找或创建 lcsc-cadence-downloader 工程并保留；已手动绑定 PCB 时复用绑定。', TITLE, 'text',
    'C5205141, C48997937', { maxlength: 4096 }, (value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return;
      void job(async () => runBatch(parseIds(value)));
    });
}
export function stopBatch(): void {
  stopRequested = true;
  eda.sys_Dialog.showInformationMessage('已请求停止。当前器件处理和清空完成后，将下载已取得的结果。', TITLE);
}
export function batchStatus(): void {
  eda.sys_Dialog.showInformationMessage(batchProgress || '尚未开始批量任务。', TITLE);
}
export function downloadLibraries(): void {
  promptId(async id => {
    const device = await lookup(id), zip = new JSZip(), manifest = freshManifest(id, device);
    await addLibraries(zip, device, manifest); await savePackage(zip, manifest);
  });
}
export function downloadSelected(): void {
  promptId(async id => {
    const device = await selectedDevice(id), zip = new JSZip(), manifest = freshManifest(id, device);
    await addLibraries(zip, device, manifest); await savePackage(zip, manifest);
  });
}
export function downloadAll(): void {
  promptId(async id => {
    await emptyPcb();
    const device = await lookup(id), zip = new JSZip(), manifest = freshManifest(id, device);
    await addLibraries(zip, device, manifest); await attemptPcb(zip, manifest, device);
    await savePackage(zip, manifest);
  });
}
export function downloadSelectedAll(): void {
  promptId(async id => {
    await emptyPcb();
    const device = await selectedDevice(id), zip = new JSZip(), manifest = freshManifest(id, device);
    await addLibraries(zip, device, manifest); await attemptPcb(zip, manifest, device);
    await savePackage(zip, manifest);
  });
}
export function exportCurrentPcb(): void {
  promptId(async id => {
    const zip = new JSZip(), manifest = freshManifest(id);
    await addPcb(zip, manifest); await savePackage(zip, manifest);
  });
}
export function diagnostics(): void {
  void job(async () => {
    await eda.sys_FileSystem.saveFile(new Blob([JSON.stringify({ version: VERSION,
      web: eda.sys_Environment.isWeb(), log }, null, 2)], { type: 'application/json' }), 'lcsc_download_diagnostics.json');
  });
}
export function about(): void {
  eda.sys_Dialog.showInformationMessage(`立创器件下载 v${VERSION}\n支持自动创建或绑定专用 PCB，批量放置、导出、清空。\n每个器件独立导出，支持顶层、0° 器件。\n配套 FreeCAD 批量提取独立模型；Cadence 转换尚未包含。`, TITLE);
}
