import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import JSZip from 'jszip';
const code = await fs.readFile('tests/dist/workflow.js', 'utf8');
const extensionManifest = JSON.parse(await fs.readFile('extensions/easyeda/extension.json', 'utf8'));
const sample = process.env.LCSC_SAMPLE_STEP ? await fs.readFile(process.env.LCSC_SAMPLE_STEP) : 'ISO-10303-21;\nEND-ISO-10303-21;';

function setup(options = {}) {
  const state = { components: options.existing ? ['initial'] : [], outlines: [], creates: 0,
    stepCalls: 0, saved: [], messages: [], currentId: 'C48997937', documentUuid: 'pcb1',
    createdPcbs: 0, deletedInDocuments: [], pcbNames: {}, deletedPcbs: [], renames: 0, infoReads: 0,
    projectCreates: 0, projectOpens: [], activeTabId: 'tab1', activeType: undefined, documentSaves: [],
    projectUuid: options.noCurrentProject ? undefined : 'export-project',
    projects: options.noExportProject ? {} : { 'export-project': 'lcsc-cadence-downloader' } };
  if (options.duplicateProjects) state.projects['duplicate'] = 'lcsc-cadence-downloader';
  if (options.foreignProject) { state.projectUuid = 'foreign-project'; state.projects['foreign-project'] = 'User Design'; }
  let done;
  let bridgeReceiver;
  const timers = new Map(); let nextTimer = 0;
  const discoveryCalls = [];
  const bridgeMessages = [];
  let completed;
  const component = {
    getState_PrimitiveId: () => 'p1', getState_Layer: () => options.layer ?? 1,
    getState_Rotation: () => options.rotation ?? 0, getState_SupplierId: () => options.supplierId ?? state.currentId,
    getState_Component: () => options.projectLibraryCopy
      ? { uuid: 'copied-device', libraryUuid: 'project-library' }
      : { uuid: 'device1', libraryUuid: 'library1' },
    getState_Model3D: () => options.missingModel ? undefined : { uuid: 'model1', libraryUuid: 'library1' },
    getState_Footprint: () => options.noActualFootprint ? undefined : ({ uuid: 'footprint1', libraryUuid: 'library1' }),
    getState_X: () => 0, getState_Y: () => 0, getState_Designator: () => 'R1',
  };
  const searchItem = { uuid: 'device1', libraryUuid: 'library1', name: '3296W-1-103',
    footprint: options.missingQueryFootprint ? undefined : { uuid: 'footprint1', libraryUuid: 'footprintLibrary' },
    model3D: { uuid: 'model1', libraryUuid: 'library1' } };
  const eda = {
    sys_ClientUrl: { request: async url => {
      discoveryCalls.push(url);
      assert.equal(url, 'http://127.0.0.1:27361/component-hub/connection');
      return { ok: !options.discoveryDenied, json: async () => ({ schema: 'component-hub-connection/v1', uri: options.discoveryUri || 'ws://127.0.0.1:12345/?token=' + 'a'.repeat(48) }) };
    } },
    sys_Dialog: {
      showInputDialog: (...args) => args.at(-1)(options.id ?? 'C48997937'),
      showSelectDialog: (...args) => args.at(-1)('0'),
      showInformationMessage: message => { state.messages.push(message); done(); },
      showConfirmationMessage: (message, _title, _ok, _cancel, callback) => { state.messages.push(message); state.confirmCompletion = callback; if (!options.deferConfirmation) callback(true); done(); },
    },
    sys_Environment: { isWeb: () => true, getUserInfo: () => options.loggedOut ? {} : {uuid:'test-user'} },
    sys_WebSocket: {
      register: (_id, _uri, receive, connected) => { bridgeReceiver = receive; connected(); },
      send: (_id, bytes) => { const message = JSON.parse(bytes); bridgeMessages.push(message); if (['exported','failed'].includes(message.type)) done?.(); },
      close: () => {},
    },
    sys_Timer: { setTimeoutTimer: (_id, _ms, callback) => { setTimeout(callback, 1); return true; } },
    dmt_Team: {
      getCurrentTeamInfo: async () => { throw new TypeError("Cannot read properties of undefined (reading 'nickname')"); },
      getAllTeamsInfo: async () => {
        if (options.teamListError) throw new TypeError("Cannot read properties of undefined (reading 'nickname')");
        return options.noTeams ? [] : options.onlyOtherTeam ? [{ uuid: 'other-team', name: '研发团队' }]
          : [{ uuid: 'personal-team', name: '个人' }, { uuid: 'other-team', name: '研发团队' }];
      },
    },
    dmt_Project: {
      getCurrentProjectInfo: async () => {
        if (options.currentProjectError) throw new TypeError("Cannot read properties of undefined (reading 'nickname')");
        return state.projectUuid ? { uuid: state.projectUuid, friendlyName: state.projects[state.projectUuid],
          teamUuid: options.currentOtherTeam ? 'other-team' : 'personal-team' } : undefined;
      },
      getAllProjectsUuid: async teamUuid => { assert.equal(teamUuid, 'personal-team'); return Object.keys(state.projects); },
      getProjectInfo: async uuid => options.projectInfoFailure ? undefined : state.projects[uuid]
        ? { uuid, friendlyName: state.projects[uuid], teamUuid: options.createdWrongTeam && uuid === 'new-export-project' ? 'other-team' : 'personal-team' } : undefined,
      createProject: async (friendlyName, name, teamUuid) => {
        assert.equal(friendlyName, 'lcsc-cadence-downloader'); assert.equal(name, undefined);
        assert.equal(teamUuid, undefined); state.projectCreates++;
        if (options.projectCreateFailure) return undefined;
        state.projects['new-export-project'] = friendlyName; return 'new-export-project';
      },
      openProject: async uuid => {
        state.projectOpens.push(uuid); if (options.projectOpenFailure) return false;
        state.projectUuid = uuid; return true;
      },
    },
    dmt_SelectControl: { getCurrentDocumentInfo: async () => ({ documentType: state.activeType ?? (state.createdPcbs ? 3 : options.documentType ?? 3),
      uuid: options.switchAfterStep && state.stepCalls ? 'foreign-pcb' : state.documentUuid,
      tabId: options.focusMismatch ? 'wrong-tab' : state.activeTabId }) },
    dmt_Pcb: {
      createPcb: async () => { state.createdPcbs++; state.pcbNames.scratch1 = 'PCB1'; return 'scratch1'; },
      modifyPcbName: async (uuid, name) => {
        assert.equal(state.documentUuid, uuid, 'PCB must be opened before rename');
        state.renames++;
        if (options.renameFailure || state.renames <= (options.renameFailures ?? 0)) return false;
        if (!options.renameFalseSuccess) { state.pcbNames[uuid] = name; return !options.renameFalsyReadback; }
        return true;
      },
      getPcbInfo: async uuid => {
        state.infoReads++;
        if (state.infoReads <= (options.delayedInfoReads ?? 0)) return undefined;
        return state.pcbNames[uuid] ? { uuid, parentProjectUuid: options.wrongPcbProject ? 'wrong-project' : state.projectUuid,
          name: options.renamedTemp && state.stepCalls ? 'user-renamed' : state.pcbNames[uuid] } : undefined;
      },
      getAllPcbsInfo: async () => state.infoReads <= (options.delayedInfoReads ?? 0) ? [] : Object.entries(state.pcbNames)
        .map(([uuid, name]) => ({ uuid, parentProjectUuid: state.projectUuid, name: options.renamedTemp && state.stepCalls ? 'user-renamed' : name })),
      deletePcb: async uuid => {
        if (options.deletePcbFailure) return false;
        state.deletedPcbs.push(uuid); delete state.pcbNames[uuid]; return true;
      },
    },
    dmt_EditorControl: {
      openDocument: async uuid => { state.documentUuid = uuid; state.activeTabId = 'tab1'; state.activeType = 3; return 'tab1'; },
      activateDocument: async tabId => {
        if (options.activateFailure) return false;
        state.activeTabId = tabId; state.activeType = tabId === 'background' ? options.backgroundType ?? 3 : undefined; return true;
      },
      getSplitScreenTree: async () => ({ id: 'root', children: [{ id: 'child', tabs: options.designTabs
        ? [{ documentType: options.backgroundType ?? 3, tabId: 'background', title: options.backgroundTitle ?? '后台 PCB' }]
        : [{ documentType: Object.hasOwn(options, 'homeType') ? options.homeType : -1,
          tabId: 'home', title: options.homeTitle ?? '首页' }] }] }),
    },
    pcb_Document: { save: async () => { state.documentSaves.push('pcb'); return !options.saveFailure; } },
    sch_Document: { save: async () => { state.documentSaves.push('sch'); return !options.saveFailure; } },
    pnl_Document: { save: async () => { state.documentSaves.push('panel'); return !options.saveFailure; } },
    sys_ToastMessage: { showMessage: () => { state.messages.push('toast'); } },
    lib_Device: {
      getByLcscIds: async ids => {
        state.currentId = ids[0];
        return options.noMatch || options.failId === ids[0] ? [] : [searchItem];
      },
      get: async () => ({ ...searchItem, property: { supplierId: 'C48997937' }, association: {
        footprint: options.fullDetailsFootprint ? { uuid: 'footprint1', libraryUuid: 'footprintLibrary' } : searchItem.footprint } }),
      search: async () => options.alternateFootprint ? [
        { ...searchItem, uuid: 'alternative', name: `part_${state.currentId}`, footprint: { uuid: 'footprint1', libraryUuid: 'footprintLibrary' } },
        { ...searchItem, uuid: 'unrelated', name: 'unrelated', footprint: { uuid: 'footprint1', libraryUuid: 'footprintLibrary' } },
      ] : [],
    },
    lib_SelectControl: { getSelectedLibraryRowInfo: async () => ({ libraryType: '3', uuid: 'device1', libraryUuid: 'library1' }) },
    sys_FileManager: {
      getDeviceFileByDeviceUuid: async () => new File(['mock library'], 'device.elibz'),
      getFootprintFileByFootprintUuid: async (uuid, libraryUuid) => {
        assert.ok(['footprintLibrary', 'library1'].includes(libraryUuid));
        if (options.footprintFailure) throw new Error('download permission denied');
        return new File(['mock footprint'], 'footprint.elibz');
      },
      getDocumentFootprintSources: async () => options.noSources ? [] : [{ footprintUuid: 'footprint1', documentSource: 'mock source' }],
      getDocumentFile: async () => new File(['mock document'], 'pcb.epro'),
    },
    sys_FileSystem: { saveFile: async (blob, name) => { state.saved.push({ blob, name }); if (name.startsWith('LCSC_batch_')) setImmediate(() => done?.()); } },
    pcb_PrimitiveComponent: {
      getAllPrimitiveId: async () => state.components,
      delete: async () => {
        state.deletedInDocuments.push(state.documentUuid);
        if (options.cleanupFailure) return false;
        state.components = []; return true;
      },
      getAll: async () => state.components.map(() => options.replacedPrimitive
        ? { ...component, getState_PrimitiveId: () => 'replacement' } : component),
      create: async (_device, layer, x, y, rotation) => {
        assert.deepEqual([layer, x, y, rotation], [1, 0, 0, 0]);
        state.creates++; state.components.push('p1'); return component;
      },
    },
    pcb_Primitive: { getPrimitivesBBox: async () => ({ minX: -100, minY: -50, maxX: 100, maxY: 50 }) },
    pcb_MathPolygon: { createPolygon: value => value },
    pcb_PrimitivePolyline: { getAllPrimitiveId: async () => state.outlines,
      delete: async () => { state.outlines = []; return true; },
      create: async () => { state.outlines.push('outline1'); return {}; } },
    pcb_ManufactureData: { get3DFile: async (_name, type, elements, mode, automatic) => {
      assert.equal(type, 'step'); assert.equal(mode, 'Outfit'); assert.equal(automatic, true);
      assert.deepEqual(Array.from(elements), ['Component Model']);
      state.stepCalls++;
      if (options.stopOnStepRequestId) bridgeReceiver({data:JSON.stringify({type:'stop',requestId:options.stopOnStepRequestId})});
      return new File([sample], 'pcb.step');
    } },
  };
  for (const suffix of ['Pad', 'Via', 'Line', 'Arc', 'Pour', 'Fill', 'Region', 'String', 'Image', 'Object', 'Dimension', 'Poured', 'Attribute'])
    eda['pcb_Primitive' + suffix] = { getAllPrimitiveId: async () => [] };
  const context = vm.createContext({ eda, Blob, File, setTimeout: (...args) => {
    if (options.controlTimers) { const id = ++nextTimer; timers.set(id, { callback: args[0], ms: args[1] }); return id; }
    const timer = setTimeout(...args); timer.unref(); return timer;
  }, clearTimeout: id => { if (options.controlTimers) timers.delete(id); else clearTimeout(id); }, console });
  vm.runInContext(code, context);
  return { state, bridgeMessages, discoveryCalls,
    startup: async () => {
      assert.equal(extensionManifest.activationEvents.onStartupFinished, true);
      context.edaEsbuildExportName.activate('onStartupFinished');
      await new Promise(resolve => setImmediate(resolve));
    },
    shutdown: () => context.edaEsbuildExportName.deactivate(),
    retry: async () => {
      const entry = [...timers].find(([, timer]) => timer.ms === 5000); assert.ok(entry, 'A retry must be scheduled');
      timers.delete(entry[0]); entry[1].callback(); await new Promise(resolve => setImmediate(resolve));
    },
    desktop: async payload => {
    completed = new Promise(resolve => { done = resolve; });
    bridgeReceiver({ data: JSON.stringify(payload) });
    await Promise.race([completed, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('desktop task timeout')), 5000); timer.unref();
    })]);
  }, run: async name => {
    completed = new Promise(resolve => { done = resolve; });
    context.edaEsbuildExportName[name]();
    await Promise.race([completed, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('workflow timeout')), 5000); timer.unref();
    })]);
    return state;
  } };
}
async function archive(state) {
  assert.equal(state.saved.length, 1, state.messages.join('\n'));
  const zip = await JSZip.loadAsync(await state.saved[0].blob.arrayBuffer());
  return { zip, manifest: JSON.parse(await zip.file('manifest.json').async('string')) };
}
test('full workflow bundles files, preserves library identity and enables EDA height fallback', async () => {
  const s = setup(); await s.run('downloadAll');
  const { zip, manifest } = await archive(s.state);
  assert.equal(s.state.creates, 1); assert.equal(s.state.stepCalls, 1);
  assert.equal(manifest.placement.footprintXMm, 0);
  assert.equal(manifest.artifacts['pcb_with_component.step'].status, 'included');
  for (const name of ['device.elibz', 'footprint.elibz', 'footprint_sources.json', 'pcb_with_component.step']) assert.ok(zip.file(name));
  if (process.env.LCSC_SAMPLE_STEP) await fs.writeFile('../sample_download.zip', Buffer.from(await s.state.saved[0].blob.arrayBuffer()));
});
test('selected-library route supports extended-library selection', async () => {
  const s = setup(); await s.run('downloadSelectedAll');
  assert.equal((await archive(s.state)).manifest.device.uuid, 'device1');
});
test('occupied PCB is refused before mutation', async () => {
  const s = setup({ existing: true }); await s.run('downloadAll');
  assert.equal(s.state.creates, 0); assert.equal(s.state.saved.length, 0);
  assert.match(s.state.messages[0], /全空白/);
});
test('invalid identifier is refused before downloads', async () => {
  const s = setup({ id: '../C123' }); await s.run('downloadAll');
  assert.equal(s.state.creates, 0); assert.equal(s.state.saved.length, 0);
});
test('unbound model exports STEP using EDA height-generated geometry', async () => {
  const s = setup({ missingModel: true }); await s.run('downloadAll');
  const { zip, manifest } = await archive(s.state);
  assert.equal(s.state.stepCalls, 1); assert.ok(zip.file('pcb_with_component.step'));
  assert.equal(manifest.artifacts['pcb_with_component.step'].status, 'included');
  assert.ok(manifest.warnings.some(x => x.includes('根据器件高度自动生成模型')));
  assert.deepEqual(manifest.modelSource,{kind:'height_placeholder',placeholder:true});
});
test('footprint failure is explicit and still permits STEP extraction', async () => {
  const s = setup({ footprintFailure: true }); await s.run('downloadAll');
  const { manifest } = await archive(s.state);
  assert.equal(manifest.artifacts['footprint.elibz'].status, 'failed');
  assert.equal(manifest.artifacts['pcb_with_component.step'].status, 'included');
});
test('existing wrong part is refused before STEP export', async () => {
  const s = setup({ existing: true, supplierId: 'C123' }); await s.run('exportCurrentPcb');
  assert.equal(s.state.stepCalls, 0); assert.equal(s.state.saved.length, 0);
});
test('bottom-side and rotated components are refused', async () => {
  for (const settings of [{ layer: 2 }, { rotation: 90 }]) {
    const s = setup({ existing: true, ...settings }); await s.run('exportCurrentPcb');
    assert.equal(s.state.stepCalls, 0);
  }
});
test('project-library UUID changes do not block the created component', async () => {
  const s = setup({ projectLibraryCopy: true }); await s.run('downloadAll');
  const { manifest } = await archive(s.state);
  assert.equal(s.state.stepCalls, 1);
  assert.equal(manifest.artifacts['pcb_with_component.step'].status, 'included');
  assert.equal(manifest.placement.component.uuid, 'copied-device');
});
test('replaced component primitive is rejected even with the same library identity', async () => {
  const s = setup({ replacedPrimitive: true }); await s.run('downloadAll');
  const { manifest } = await archive(s.state);
  assert.equal(s.state.stepCalls, 0);
  assert.equal(manifest.artifacts['pcb_with_component.step'].status, 'failed');
});
test('batch auto-creates one PCB, deduplicates IDs, exports each part and clears the board', async () => {
  const s = setup({ id: 'C48997937, C5205141, C48997937' }); await s.run('batchDownload');
  const zip = await JSZip.loadAsync(await s.state.saved[0].blob.arrayBuffer());
  const report = JSON.parse(await zip.file('batch_manifest.json').async('string'));
  assert.equal(s.state.createdPcbs, 1); assert.equal(s.state.creates, 2); assert.equal(s.state.stepCalls, 2);
  assert.equal(report.results.length, 2); assert.ok(report.results.every(x => x.status === 'complete'));
  assert.deepEqual(s.state.components, []); assert.deepEqual(s.state.outlines, []);
  assert.ok(s.state.deletedInDocuments.every(x => x === 'scratch1'));
  assert.deepEqual(s.state.deletedPcbs, ['scratch1']);
  assert.equal(report.pcbCleanup.status, 'temporary_pcb_deleted');
  for (const id of ['C48997937', 'C5205141']) assert.ok(zip.file(`${id}/pcb_with_component.step`));
  if (process.env.LCSC_SAMPLE_STEP) await fs.writeFile('../sample_batch_download.zip', Buffer.from(await s.state.saved[0].blob.arrayBuffer()));
});
test('explicitly bound PCB can be cleared and reused without creating another PCB', async () => {
  const s = setup({ existing: true }); await s.run('bindExportPcb'); await s.run('batchDownload');
  assert.equal(s.state.createdPcbs, 0); assert.equal(s.state.stepCalls, 1);
  assert.deepEqual(s.state.components, []); assert.deepEqual(s.state.outlines, []);
  assert.ok(s.state.deletedInDocuments.every(x => x === 'pcb1'));
  assert.deepEqual(s.state.deletedPcbs, []);
});
test('a lookup failure is recorded and the next batch item still exports', async () => {
  const s = setup({ id: 'C123 C48997937', failId: 'C123' }); await s.run('batchDownload');
  const zip = await JSZip.loadAsync(await s.state.saved[0].blob.arrayBuffer());
  const report = JSON.parse(await zip.file('batch_manifest.json').async('string'));
  assert.equal(report.results[0].status, 'failed'); assert.equal(report.results[1].status, 'complete');
  assert.equal(s.state.stepCalls, 1); assert.deepEqual(s.state.components, []);
});
test('cleanup failure stops the queue before another component is placed', async () => {
  const s = setup({ id: 'C48997937 C5205141', cleanupFailure: true }); await s.run('batchDownload');
  const zip = await JSZip.loadAsync(await s.state.saved[0].blob.arrayBuffer());
  const report = JSON.parse(await zip.file('batch_manifest.json').async('string'));
  assert.equal(s.state.creates, 1); assert.ok(report.stoppedReason);
  assert.equal(report.results[1].status, 'not_started');
});
test('switching PCB during export stops cleanup and never deletes from the foreign PCB', async () => {
  const s = setup({ id: 'C48997937 C5205141', switchAfterStep: true }); await s.run('batchDownload');
  const zip = await JSZip.loadAsync(await s.state.saved[0].blob.arrayBuffer());
  const report = JSON.parse(await zip.file('batch_manifest.json').async('string'));
  assert.equal(s.state.creates, 1); assert.ok(report.stoppedReason);
  assert.deepEqual(s.state.deletedInDocuments, []);
  assert.equal(report.results[1].status, 'not_started');
});

test('missing query footprint is recovered from complete device details', async () => {
  const s = setup({ missingQueryFootprint: true, fullDetailsFootprint: true }); await s.run('downloadAll');
  const { manifest } = await archive(s.state);
  assert.equal(s.state.creates, 1);
  assert.equal(manifest.artifacts['footprint.elibz'].status, 'included');
});

test('exact alternate search can recover association without selecting unrelated parts', async () => {
  const s = setup({ missingQueryFootprint: true, alternateFootprint: true }); await s.run('downloadAll');
  const { manifest } = await archive(s.state);
  assert.equal(manifest.device.uuid, 'alternative');
  assert.equal(manifest.artifacts['pcb_with_component.step'].status, 'included');
});

test('missing query association still attempts placement and downloads actual footprint', async () => {
  const s = setup({ missingQueryFootprint: true, noSources: true }); await s.run('downloadAll');
  const { zip, manifest } = await archive(s.state);
  assert.equal(s.state.creates, 1); assert.equal(s.state.stepCalls, 1);
  assert.equal(manifest.device.footprint.libraryUuid, 'library1');
  assert.equal(manifest.artifacts['footprint.elibz'].status, 'included');
  assert.ok(zip.file('pcb_document.epro'));
});

test('unresolved actual footprint is reported after placement without exporting STEP', async () => {
  const s = setup({ missingQueryFootprint: true, noActualFootprint: true }); await s.run('downloadAll');
  const { manifest } = await archive(s.state);
  assert.equal(s.state.creates, 1); assert.equal(s.state.stepCalls, 0);
  assert.match(JSON.stringify(manifest), /已尝试放置/);
});

test('created export PCB has a unique temp name and is deleted after batch', async () => {
  const s = setup(); await s.run('createExportPcb');
  assert.match(s.state.pcbNames.scratch1, /^temp_lcsc_\d+_[a-z0-9]+$/);
  await s.run('batchDownload'); assert.deepEqual(s.state.deletedPcbs, ['scratch1']);
});

test('temporary PCB deletion failure is explicit in the batch report', async () => {
  const s = setup({ deletePcbFailure: true }); await s.run('batchDownload');
  const zip = await JSZip.loadAsync(await s.state.saved[0].blob.arrayBuffer());
  const report = JSON.parse(await zip.file('batch_manifest.json').async('string'));
  assert.equal(report.pcbCleanup.status, 'delete_failed');
  assert.ok(report.pcbCleanup.message); assert.equal(s.state.messages.length,0);
});

test('renamed temporary PCB is preserved and ownership mismatch reported', async () => {
  const s = setup({ renamedTemp: true }); await s.run('batchDownload');
  const zip = await JSZip.loadAsync(await s.state.saved[0].blob.arrayBuffer());
  const report = JSON.parse(await zip.file('batch_manifest.json').async('string'));
  assert.equal(report.pcbCleanup.status, 'delete_failed');
  assert.deepEqual(s.state.deletedPcbs, []);
});

test('creation waits for document registration and retries rename after opening', async () => {
  const s = setup({ delayedInfoReads: 2, renameFailures: 2 }); await s.run('batchDownload');
  assert.equal(s.state.renames, 3); assert.equal(s.state.stepCalls, 1);
  assert.deepEqual(s.state.deletedPcbs, ['scratch1']);
});

test('rename returning false with correct readback still proceeds', async () => {
  const s = setup({ renameFalsyReadback: true }); await s.run('batchDownload');
  assert.equal(s.state.stepCalls, 1); assert.equal(s.state.renames, 1);
});

test('permanent rename failure rolls back the newly created PCB', async () => {
  const s = setup({ renameFailure: true }); await s.run('batchDownload');
  assert.equal(s.state.renames, 6); assert.equal(s.state.creates, 0);
  assert.deepEqual(s.state.deletedPcbs, ['scratch1']);
  assert.match(s.state.messages.at(-1), /本次创建的 PCB 已删除/);
});

test('truthy rename result without name change is rejected and rolled back', async () => {
  const s = setup({ renameFalseSuccess: true }); await s.run('batchDownload');
  assert.equal(s.state.renames, 6); assert.equal(s.state.stepCalls, 0);
  assert.deepEqual(s.state.deletedPcbs, ['scratch1']);
});

test('failed rollback is reported with UUID instead of being silently ignored', async () => {
  const s = setup({ renameFailure: true, deletePcbFailure: true }); await s.run('batchDownload');
  assert.deepEqual(s.state.deletedPcbs, []);
  assert.match(s.state.messages.at(-1), /未能确认临时 PCB 已删除.*scratch1/);
});

test('create menu does not leak another temporary PCB while one is pending', async () => {
  const s = setup(); await s.run('createExportPcb'); await s.run('createExportPcb');
  assert.equal(s.state.createdPcbs, 1);
  assert.match(s.state.messages.at(-1), /已有临时 PCB/);
});

test('homepage batch creates a missing dedicated project then exports', async () => {
  const s = setup({ noCurrentProject: true, noExportProject: true }); await s.run('batchDownload');
  assert.equal(s.state.projectCreates, 1); assert.deepEqual(s.state.projectOpens, ['new-export-project']);
  assert.equal(s.state.stepCalls, 1);
  assert.equal(s.state.projects['new-export-project'], 'lcsc-cadence-downloader');
});
test('existing project is found and opened from homepage without duplication', async () => {
  const s = setup({ noCurrentProject: true }); await s.run('batchDownload');
  assert.equal(s.state.projectCreates, 0); assert.deepEqual(s.state.projectOpens, ['export-project']);
  assert.equal(s.state.stepCalls, 1);
});
test('second batch reuses dedicated project and creates no duplicate project', async () => {
  const s = setup({ noCurrentProject: true, noExportProject: true });
  await s.run('batchDownload'); await s.run('batchDownload');
  assert.equal(s.state.projectCreates, 1); assert.equal(s.state.stepCalls, 2);
});
test('duplicate project names stop before opening or creating PCB', async () => {
  const s = setup({ duplicateProjects: true }); await s.run('batchDownload');
  assert.equal(s.state.createdPcbs, 0); assert.equal(s.state.projectCreates, 0);
  assert.match(s.state.messages.at(-1), /多个/);
});
test('unreadable project info does not trigger duplicate creation', async () => {
  const s = setup({ projectInfoFailure: true }); await s.run('batchDownload');
  assert.equal(s.state.projectCreates, 0); assert.equal(s.state.createdPcbs, 0);
});
test('background save failure blocks switching before project or PCB creation', async () => {
  const s = setup({ foreignProject: true, designTabs: true, noExportProject: true, saveFailure: true }); await s.run('batchDownload');
  assert.deepEqual(s.state.projectOpens, []); assert.equal(s.state.projectCreates, 0);
  assert.equal(s.state.createdPcbs, 0); assert.match(s.state.messages.at(-1), /后台 PCB.*保存失败/);
});
test('project open failure stops before PCB creation', async () => {
  const s = setup({ noCurrentProject: true, projectOpenFailure: true }); await s.run('batchDownload');
  assert.equal(s.state.createdPcbs, 0); assert.match(s.state.messages.at(-1), /打开失败/);
});
test('PCB created in an unexpected project is rejected and rolled back', async () => {
  const s = setup({ wrongPcbProject: true }); await s.run('batchDownload');
  assert.equal(s.state.stepCalls, 0); assert.deepEqual(s.state.deletedPcbs, ['scratch1']);
  assert.match(s.state.messages.at(-1), /不属于专用工程/);
});

test('homepage avoids context-dependent current APIs and uses personal team list', async () => {
  const s = setup({ documentType: -1, noCurrentProject: true, noExportProject: true, currentProjectError: true });
  await s.run('batchDownload');
  assert.equal(s.state.projectCreates, 1); assert.equal(s.state.stepCalls, 1);
});
test('current project nickname error falls back to explicit team listing', async () => {
  const s = setup({ noCurrentProject: true, currentProjectError: true }); await s.run('batchDownload');
  assert.deepEqual(s.state.projectOpens, ['export-project']); assert.equal(s.state.stepCalls, 1);
});
test('team list error identifies failing API and does not create project', async () => {
  const s = setup({ documentType: -1, noCurrentProject: true, teamListError: true }); await s.run('batchDownload');
  assert.equal(s.state.projectCreates, 0); assert.equal(s.state.createdPcbs, 0);
  assert.match(s.state.messages.at(-1), /getAllTeamsInfo.*nickname/);
});
test('no available teams stops before querying or creating a project', async () => {
  const s = setup({ documentType: -1, noCurrentProject: true, noTeams: true }); await s.run('batchDownload');
  assert.equal(s.state.projectCreates, 0); assert.equal(s.state.createdPcbs, 0);
  assert.match(s.state.messages.at(-1), /无法唯一识别个人空间/);
});

test('homepage saves background PCB and continues project switching', async () => {
  const s = setup({ documentType: -1, noCurrentProject: true, designTabs: true }); await s.run('batchDownload');
  assert.ok(s.state.documentSaves.includes('pcb')); assert.equal(s.state.stepCalls, 1);
  assert.deepEqual(s.state.projectOpens, ['export-project']);
});
test('readonly previews do not require saving or closing before switching', async () => {
  for (const backgroundType of [12, 15, 27]) {
    const s = setup({ documentType: -1, noCurrentProject: true, designTabs: true, backgroundType });
    await s.run('batchDownload'); assert.equal(s.state.stepCalls, 1); assert.deepEqual(s.state.documentSaves, []);
  }
});
test('background schematic and panel use corresponding save APIs', async () => {
  for (const [backgroundType, api] of [[1, 'sch'], [26, 'panel']]) {
    const s = setup({ documentType: -1, noCurrentProject: true, designTabs: true, backgroundType });
    await s.run('batchDownload'); assert.equal(s.state.stepCalls, 1);
    assert.ok(s.state.documentSaves.every(x => x === api)); assert.ok(s.state.documentSaves.length);
  }
});
test('unsupported library editor is named and preserved without switching', async () => {
  const s = setup({ documentType: -1, noCurrentProject: true, designTabs: true, backgroundType: 4 });
  await s.run('batchDownload'); assert.deepEqual(s.state.projectOpens, []);
  assert.deepEqual(s.state.documentSaves, []); assert.match(s.state.messages.at(-1), /库或其他编辑标签页.*后台 PCB/);
});
test('activation failure blocks automatic save and project switching', async () => {
  const s = setup({ documentType: -1, noCurrentProject: true, designTabs: true, activateFailure: true });
  await s.run('batchDownload'); assert.deepEqual(s.state.projectOpens, []);
  assert.deepEqual(s.state.documentSaves, []); assert.match(s.state.messages.at(-1), /无法激活/);
});
test('wrong focus blocks save and project switching', async () => {
  const s = setup({ documentType: -1, noCurrentProject: true, designTabs: true, focusMismatch: true });
  await s.run('batchDownload'); assert.deepEqual(s.state.projectOpens, []);
  assert.deepEqual(s.state.documentSaves, []); assert.match(s.state.messages.at(-1), /焦点核验失败/);
});

test('Start Page is accepted with missing, string or named home document type', async () => {
  for (const homeType of [undefined, null, '-1', 'HOME', 'Start Page', 'START_PAGE', 99]) {
    const s = setup({ documentType: -1, noCurrentProject: true, homeType, homeTitle: 'Start Page' });
    await s.run('batchDownload'); assert.equal(s.state.stepCalls, 1, s.state.messages.join('\n'));
    assert.deepEqual(s.state.documentSaves, []);
  }
});
test('numeric string PCB type is saved with the PCB API', async () => {
  const s = setup({ documentType: -1, noCurrentProject: true, designTabs: true, backgroundType: '3' });
  await s.run('batchDownload'); assert.equal(s.state.stepCalls, 1);
  assert.ok(s.state.documentSaves.length); assert.ok(s.state.documentSaves.every(x => x === 'pcb'));
});
test('PCB named Start Page still requires saving', async () => {
  const s = setup({ documentType: -1, noCurrentProject: true, designTabs: true,
    backgroundType: 3, backgroundTitle: 'Start Page', saveFailure: true });
  await s.run('batchDownload'); assert.equal(s.state.stepCalls, 0);
  assert.match(s.state.messages.at(-1), /Start Page.*保存失败/);
});
test('unknown tab not named home is preserved and blocks switching', async () => {
  const s = setup({ documentType: -1, noCurrentProject: true, homeType: undefined, homeTitle: 'Unrecognized Editor' });
  await s.run('batchDownload'); assert.equal(s.state.stepCalls, 0);
  assert.match(s.state.messages.at(-1), /Unrecognized Editor/);
});

test('foreign active team does not change personal export project scope', async () => {
  const s = setup({ foreignProject: true, currentOtherTeam: true }); await s.run('batchDownload');
  assert.equal(s.state.stepCalls, 1); assert.deepEqual(s.state.projectOpens, ['export-project']);
  assert.equal(s.state.projectCreates, 0);
});
test('missing personal identity never silently creates in a business team', async () => {
  const s = setup({ documentType: -1, noCurrentProject: true, onlyOtherTeam: true }); await s.run('batchDownload');
  assert.equal(s.state.projectCreates, 0); assert.deepEqual(s.state.projectOpens, []);
  assert.match(s.state.messages.at(-1), /未改用其他团队/);
});
test('undefined create result states actual API outcome without blaming permissions', async () => {
  const s = setup({ documentType: -1, noCurrentProject: true, noExportProject: true, projectCreateFailure: true });
  await s.run('batchDownload'); assert.equal(s.state.projectCreates, 1); assert.equal(s.state.createdPcbs, 0);
  assert.match(s.state.messages.at(-1), /未返回工程 UUID.*默认个人空间/);
});
test('created project must belong to verified personal identity before opening', async () => {
  const s = setup({ documentType: -1, noCurrentProject: true, noExportProject: true, createdWrongTeam: true });
  await s.run('batchDownload'); assert.equal(s.state.createdPcbs, 0); assert.deepEqual(s.state.projectOpens, []);
  assert.match(s.state.messages.at(-1), /不属于已识别的个人空间/);
});

test('desktop bridge exports a received task and reports correlated results', async () => {
  const s = setup({ id: 'ws://127.0.0.1:12345/?token=' + 'a'.repeat(48) });
  await s.run('connectDesktopManual'); assert.equal(s.bridgeMessages[0].type, 'hello');
  const requestId = '11111111-1111-4111-8111-111111111111';
  await s.desktop({ type: 'export', requestId, ids: ['C5205141', 'C48997937'] });
  assert.equal(s.state.stepCalls, 2); assert.equal(s.state.saved.length, 1);
  const finished = s.bridgeMessages.find(x => x.type === 'exported');
  assert.equal(finished.requestId, requestId); assert.equal(finished.results.length, 2);
  assert.ok(s.bridgeMessages.some(x => x.type === 'progress'));
});
test('public extension menus expose only connection and runtime sources belong to the app', async () => {
  for (const menus of Object.values(extensionManifest.headerMenus)) assert.deepEqual(menus[0].menuItems.map(x => x.registerFn), ['connectDesktop']);
  assert.match(await fs.readFile('extensions/easyeda/src/main.ts','utf8'), /src\/easyeda\/runtime/);
});
test('logged-out SDK session cannot connect or create export documents', async () => {
  const s = setup({ loggedOut: true }); await s.run('connectDesktop');
  assert.equal(s.bridgeMessages.length, 0); assert.equal(s.state.createdPcbs, 0); assert.match(s.state.messages.at(-1), /先登录/);
});
test('desktop export reports results without a plugin completion dialog', async () => {
  const s = setup(); await s.run('connectDesktop'); s.state.messages.length = 0;
  const requestId = '11111111-1111-4111-8111-111111111111';
  await s.desktop({type:'export',requestId,ids:['C5205141']});
  assert.ok(s.bridgeMessages.some(x=>x.type==='exported')); assert.ok(!s.bridgeMessages.some(x=>x.type==='acknowledged'));
  assert.equal(s.state.messages.length, 0);
  const result = s.bridgeMessages.find(x=>x.type==='exported');
  assert.equal(result.requestId, requestId); assert.equal(result.results[0].status, 'complete');
  assert.equal(result.pcbCleanup.status, 'temporary_pcb_deleted');
  const progress = s.bridgeMessages.filter(x=>x.type==='progress' && x.progress).map(x=>x.progress);
  assert.equal(progress[0].completed,0); assert.equal(progress[0].total,1);
  assert.ok(progress.some(x=>x.currentId==='C5205141' && x.stage==='导出 STEP 模型'));
  assert.ok(progress.some(x=>x.completed===1 && x.stage==='打包导出文件'));
});
test('desktop bridge refuses invalid task component data before mutation', async () => {
  const s = setup({ id: 'ws://127.0.0.1:12345/?token=' + 'a'.repeat(48) }); await s.run('connectDesktopManual');
  await s.desktop({ type: 'export', requestId: '11111111-1111-4111-8111-111111111111', ids: ['../C123'] });
  assert.equal(s.state.createdPcbs, 0); assert.ok(s.bridgeMessages.some(x => x.type === 'failed'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(s.state.messages.length, 1, 'only the initial connection dialog is shown');
});

test('desktop progress counts failed parts and continues without plugin notices', async () => {
  const s = setup({failId:'C123'}); await s.run('connectDesktop'); s.state.messages.length = 0;
  await s.desktop({type:'export',requestId:'11111111-1111-4111-8111-111111111111',ids:['C123','C5205141']});
  const updates = s.bridgeMessages.filter(x=>x.progress).map(x=>x.progress);
  assert.ok(updates.some(x=>x.completed===1 && x.currentId==='C5205141' && x.stage==='查找元件'));
  assert.equal(updates.at(-1).completed,2); assert.equal(updates.at(-1).total,2);
  for (let i=1;i<updates.length;i++) assert.ok(updates[i].completed>=updates[i-1].completed);
  assert.deepEqual(s.bridgeMessages.find(x=>x.type==='exported').results.map(x=>x.status),['failed','complete']);
  assert.equal(s.state.messages.length,0);
});

test('desktop stop preserves current STEP, cleans PCB and skips remaining parts without dialogs', async () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  const s = setup({stopOnStepRequestId:requestId}); await s.run('connectDesktop'); s.state.messages.length=0;
  await s.desktop({type:'export',requestId,ids:['C5205141','C123']});
  const result = s.bridgeMessages.find(x=>x.type==='exported');
  assert.match(result.stoppedReason,/用户请求中止/);
  assert.deepEqual(result.results.map(x=>x.status),['complete','not_started']);
  assert.equal(s.state.stepCalls,1); assert.deepEqual(s.state.components,[]);
  assert.deepEqual(s.state.deletedPcbs,['scratch1']); assert.equal(s.state.messages.length,0);
  const zip = await JSZip.loadAsync(await s.state.saved[0].blob.arrayBuffer());
  assert.ok(zip.file('C5205141/pcb_with_component.step')); assert.equal(zip.file('C123/pcb_with_component.step'),null);
});

test('stop with a different request ID cannot cancel a desktop export', async () => {
  const s = setup({stopOnStepRequestId:'22222222-2222-4222-8222-222222222222'}); await s.run('connectDesktop');
  await s.desktop({type:'export',requestId:'11111111-1111-4111-8111-111111111111',ids:['C5205141','C123']});
  assert.equal(s.state.stepCalls,2);
  assert.equal(s.bridgeMessages.find(x=>x.type==='exported').stoppedReason,'');
});

test('automatic desktop connection needs no input dialog and receives export tasks', async () => {
  const s = setup(); await s.run('connectDesktop'); assert.equal(s.bridgeMessages[0].type, 'hello');
  await s.desktop({ type: 'export', requestId: '11111111-1111-4111-8111-111111111111', ids: ['C5205141'] });
  assert.equal(s.state.stepCalls, 1); assert.ok(s.bridgeMessages.some(x => x.type === 'exported'));
});
test('automatic connection refuses denied discovery and non-loopback connection data', async () => {
  for (const options of [{ discoveryDenied: true }, { discoveryUri: 'ws://evil.example/' }]) {
    const s = setup(options); await s.run('connectDesktop');
    assert.equal(s.bridgeMessages.length, 0); assert.equal(s.state.createdPcbs, 0);
  }
});

test('startup event silently connects without invoking any menu and activation is idempotent', async t => {
  const s = setup({ controlTimers: true }); t.after(s.shutdown);
  await s.startup(); assert.equal(s.bridgeMessages[0].type, 'hello');
  assert.equal(s.state.messages.length, 0); assert.equal(s.discoveryCalls.length, 1);
  await s.startup(); assert.equal(s.discoveryCalls.length, 1);
  await s.desktop({ type: 'export', requestId: '11111111-1111-4111-8111-111111111111', ids: ['C5205141'] });
  assert.equal(s.state.stepCalls, 1);
});
test('startup retries quietly after unavailable discovery and connects when it recovers', async t => {
  const options = { controlTimers: true, discoveryDenied: true };
  const s = setup(options); t.after(s.shutdown); await s.startup();
  assert.equal(s.bridgeMessages.length, 0); assert.equal(s.state.messages.length, 0);
  await s.retry(); assert.equal(s.discoveryCalls.length, 2); assert.equal(s.state.messages.length, 0);
  options.discoveryDenied = false; await s.retry();
  assert.equal(s.bridgeMessages[0].type, 'hello'); assert.equal(s.state.messages.length, 0);
});
