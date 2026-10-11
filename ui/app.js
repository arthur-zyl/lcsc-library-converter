let state, settingsDirty = false, settingsSaving = false, toolDetectionBusy=false,preflightBusy=false;
const dirtyGroups=new Set();let activeSettingsGroup="general";
function markSettingsDirty(group){dirtyGroups.add(group);settingsDirty=true;}
function selectSettingsGroup(group, focus=false) {
  activeSettingsGroup=group;
  const button=document.querySelector(`[data-settings-group="${group}"]`);if(!button)return;
  document.querySelectorAll('[data-settings-group]').forEach(tab=>{const active=tab.dataset.settingsGroup===group;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});
  document.querySelectorAll('[data-settings-panel]').forEach(panel=>{panel.hidden=panel.dataset.settingsPanel!==group;});
  if(focus)button.focus();
  if(state)render(state);
}
const settingKeys = ['kicadFootprintSource','cadenceFootprintSource','kicadFootprintDir','cadenceFootprintDir','freecadPython','kicadCli','kicadDir','kicadFootprintLibraryName','cadenceRoot','cadenceDir','cadenceLibraryName','altiumDir','altiumLibraryName','altiumFootprintSource','altiumFootprintDir'];
const $ = id => document.getElementById(id);
let noticeTimer;
function notice(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000); }
async function call(action, value) { try { const result = await window.hub.call(action, value); if (result?.ok === false) notice(result.message); return result; } catch (e) { notice(e.message); } }
function text(tag, value) { const element = document.createElement(tag); element.textContent = value; return element; }
function render(s) {
  const pageChanged = state?.page !== s.page;
  state = s; $('count').textContent = s.queue.length;
  $('back').disabled = s.edaLocked || !s.navigation?.back; $('forward').disabled = s.edaLocked || !s.navigation?.forward;
  $('url').disabled = s.edaLocked || !s.navigation?.available;
  if (pageChanged || document.activeElement !== $('url')) $('url').value = s.navigation?.url || '';
  $('refresh').disabled = s.edaLocked || !s.navigation?.available;
  const connectionStatus = s.converting ? 'converting' : s.processing ? 'processing' : s.bridge.active ? 'exporting' : s.edaLogin === 'signed-out' ? 'signed-out' : s.bridge.connected ? 'connected' : 'connecting';
  const connectionLabel = {converting:'正在转换元件库',processing:'正在提取模型',exporting:'正在导出',connected:'插件已连接',connecting:s.edaLogin === 'checking' ? '正在检查登录' : '插件未连接','signed-out':'未登录'}[connectionStatus];
  $('connection').dataset.status = connectionStatus; $('connection-label').textContent = '立创 EDA ' + connectionLabel;
  $('export').disabled = preflightBusy || !s.queue.length || !!s.bridge.active || s.processing || s.converting;
  $('clear').disabled = !s.queue.length || !!s.bridge.active || s.processing || s.converting;
  $('export').textContent = s.converting ? '正在转换库…' : s.processing ? '正在提取模型…' : s.bridge.active ? '正在导出…' : '开始批量导出';
  $('cart').hidden = s.page !== 'queue'; $('cart-total').textContent = s.queue.length + ' 个元件';
  const loggedOut = s.edaLogin === 'signed-out';
  const pluginMissing = !s.bridge.connected && s.edaLogin !== 'checking';
  const needsSetup = s.page!=='setup' && (loggedOut || pluginMissing);
  $('login-banner').hidden = !needsSetup; document.querySelector('main').classList.toggle('needs-login', needsSetup);
  $('login-message').textContent = loggedOut ? '立创 EDA 未登录，请先登录。' : (s.edaLogin === 'signed-in' ? '立创 EDA 已登录。' : '') + '连接插件未连接，请导入插件并开启外部交互权限。';
  $('open-login').textContent = loggedOut ? '前往登录' : '前往立创 EDA';
  $('plugin-path-login').hidden = loggedOut;
  document.querySelector('.toolbar').hidden = needsSetup || !['shop', 'eda'].includes(s.page);
  $('plugin-path').hidden = s.page !== 'eda';
  $('queue').replaceChildren();
  if (!s.queue.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.append(text('strong', '清单里还没有元件'), text('div', '去商城选料，在商品旁点击「加入清单」。')); $('queue').append(empty); }
  for (const item of s.queue) {
    const row = document.createElement('div'); row.className = 'cart-item';
    const info = document.createElement('div'); info.className = 'product-info';
    const picture = document.createElement('div'); picture.className = 'product-image';
    if (item.image) { const img = document.createElement('img'); img.src = item.image; img.alt = item.name; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.addEventListener('error', () => picture.replaceChildren(text('span', '暂无图片')), { once: true }); picture.append(img); }
    else { picture.classList.add('empty-image'); picture.append(text('span', '◇')); }
    const details = document.createElement('div'); details.className = 'product-text';
    const id = text('span', item.id); id.className = 'part-id';
    const heading = document.createElement('div'); heading.className = 'product-heading'; heading.append(text('strong', item.name), id); details.append(heading);
    if (item.summary) { const summary = text('p', item.summary); summary.className = 'product-summary'; details.append(summary); }
    const metadata = s.metadata?.[item.id];
    if (metadata?.status === 'loading') { const progress = text('p', '正在读取商品参数…'); progress.className = 'metadata-progress'; details.append(progress); }
    if (metadata?.status === 'error') { const error = document.createElement('div'); error.className = 'metadata-error'; const message = text('span', '商品参数读取失败'); message.title = metadata.message; const retry = text('button', '重新读取'); retry.addEventListener('click', () => call('details', item.id)); error.append(message, retry); details.append(error); }
    if (item.parameters?.length) { const parameters = document.createElement('dl'); parameters.className = 'product-parameters'; for (const parameter of item.parameters) { const pair = document.createElement('div'); pair.append(text('dt', parameter.name), text('dd', parameter.value)); parameters.append(pair); } details.append(parameters); }
    const footer = document.createElement('div'); footer.className = 'product-footer';
    if (item.label || item.packaging || item.packSize || item.stock !== null && item.stock !== undefined) { const tags = document.createElement('div'); tags.className = 'product-tags'; for (const tag of [item.label, item.packaging, item.packSize, item.stock !== null && item.stock !== undefined ? '现货 ' + item.stock.toLocaleString('zh-CN') : ''].filter(Boolean)) tags.append(text('span', tag)); footer.append(tags); }
    if (item.description) { const description = text('span', item.description); description.className = 'product-description'; description.title = item.description; footer.append(description); }
    if (footer.childElementCount) details.append(footer);
    info.append(picture, details);
    const specs = document.createElement('div'); specs.className = 'product-spec'; if (item.brand) specs.append(text('strong', item.brand)); if (item.package) specs.append(text('small', '封装：' + item.package)); if (item.category) specs.append(text('small', '分类：' + item.category));
    const actions = document.createElement('div'); actions.className = 'row-actions';
    const link = text('button', '商品页'); link.disabled = !item.url; link.addEventListener('click', () => call('product', item.id));
    const remove = text('button', '移除'); remove.disabled = s.processing || !!s.bridge.active?.ids.includes(item.id); remove.addEventListener('click', () => call('remove', item.id));
    const outcome=s.exportItemResults?.[s.exportTarget || 'kicad']?.[item.id];
    if(outcome){const status=text('div',outcome.label+'：'+outcome.message);status.className='item-result';status.dataset.status=outcome.status;status.title=outcome.message;details.append(status);if(outcome.status!=='converted'){const retry=text('button','重试');retry.disabled=s.processing || s.converting || !!s.bridge.active;retry.addEventListener('click',()=>startExport([item.id]));actions.append(retry);}}
    actions.append(link, remove); row.append(info, specs, actions); $('queue').append(row);
  }
  $('export-target').value=s.exportTarget || 'kicad';$('export-target').disabled=s.edaLocked || s.processing || s.converting;
  $('footprint-source').value=s.settings?.[(s.exportTarget || 'kicad')+'FootprintSource'] || 'easyeda';$('footprint-source').disabled=s.edaLocked || s.processing || s.converting;
  $('export-log').disabled=s.edaLocked || s.processing || s.converting || !s.lastExportLogs?.[s.exportTarget || 'kicad'];
  $('output-folder').disabled=s.edaLocked || s.processing || s.converting;
  $('settings').hidden = s.page !== 'settings';
  renderSetup(s);
  if (s.settings) for (const key of settingKeys) if(!dirtyGroups.has($('setting-'+key).closest('[data-settings-panel]').dataset.settingsPanel)) $('setting-'+key).value = s.settings[key] ?? (key.endsWith('Source')?'easyeda':'');
  if(!dirtyGroups.has('cadence') && s.settings){$('power-rules').value=s.settings.cadencePowerRules?.patterns || '';$('power-legacy-note').hidden=!s.settings.cadencePowerRules?.legacy; }
  $('power-config-path').textContent='配置文件：'+(s.settings?.cadencePowerRulesPath || '');
  const settingsLocked = toolDetectionBusy || !!s.bridge.active || s.processing || s.converting || s.settingsBusy || settingsSaving;
  for (const element of $('settings-form').querySelectorAll('input,select,textarea,button')) element.disabled = settingsLocked;
  $('settings-save').textContent = s.settingsBusy || settingsSaving ? '正在保存…' : '保存当前设置';
  if (s.processing || s.bridge.active || s.converting) $('settings-hint').textContent = '导出或处理期间暂不能修改设置。';
  else $('settings-hint').textContent = dirtyGroups.has(activeSettingsGroup) ? '当前分组有未保存的修改。' : dirtyGroups.size ? '其他分组有未保存的修改，切换后可分别保存。' : '仅保存当前分组；修改设置不移动已有库。';
  document.querySelectorAll('[data-page]').forEach(b => { b.classList.toggle('active', b.dataset.page === s.page); b.disabled = !!s.edaLocked; });
  $('connection-log').textContent = s.logs.slice(-20).map(x => x.time + '  ' + x.message).join('\n') || '暂无连接日志';
}
document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => call('page', b.dataset.page)));
const settingsTabs=[...document.querySelectorAll('[data-settings-group]')];
for(const [index,tab] of settingsTabs.entries()) {
  tab.addEventListener('click',()=>selectSettingsGroup(tab.dataset.settingsGroup));
  tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowDown')next=(index+1)%settingsTabs.length;else if(event.key==='ArrowUp')next=(index+settingsTabs.length-1)%settingsTabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=settingsTabs.length-1;else return;event.preventDefault();selectSettingsGroup(settingsTabs[next].dataset.settingsGroup,true);});
}
for (const id of ['back', 'forward', 'refresh', 'pair', 'pair-manual', 'installer', 'open-login','output-folder','export-log']) $(id).addEventListener('click', () => call(id));
$('preflight-close').addEventListener('click',()=>$('preflight-dialog').close());
async function startExport(ids){
  if(preflightBusy)return;const target=$('export-target').value;const request=ids?{target,ids}:target;preflightBusy=true;render(state);$('export').textContent='正在检查…';
  try{const result=await window.hub.call('export-check',request);if(result?.ok){await call('export',request);return;}
    $('preflight-checks').replaceChildren();for(const check of result?.checks || [{label:'检查失败',message:result?.message || '请重试'}]){const row=document.createElement('div');row.className='preflight-row';row.dataset.ok=String(!!check.ok);row.append(text('strong',(check.ok?'✓ ':'! ')+check.label),text('p',check.message));if(!check.ok && check.group && check.group!=='queue'){const button=text('button',check.group==='eda'?'前往立创 EDA':'打开设置');button.addEventListener('click',async()=>{$('preflight-dialog').close();await call('page',check.group==='eda'?'eda':'settings');if(check.group!=='eda')selectSettingsGroup(check.group);});row.append(button);}$('preflight-checks').append(row);}$('preflight-dialog').showModal();
  }catch(e){notice(e.message);}finally{preflightBusy=false;render(state);}
}
$('export').addEventListener('click',()=>startExport());
$('footprint-source').addEventListener('change',()=>call('footprint-source',$('footprint-source').value));
$('export-target').addEventListener('change',()=>call('export-target',$('export-target').value));
for (const key of settingKeys) $('setting-'+key).addEventListener('input', () => { markSettingsDirty($('setting-'+key).closest('[data-settings-panel]').dataset.settingsPanel); $('settings-hint').textContent = '有未保存的修改，保存后生效。'; });
document.querySelectorAll('[data-setting-pick]').forEach(button => button.addEventListener('click', async () => {
  const key = button.dataset.settingPick;
  const result = await call('settings-pick',key);
  if (result?.path) { $('setting-'+key).value = result.path; markSettingsDirty($('setting-'+key).closest('[data-settings-panel]').dataset.settingsPanel); render(state); }
}));
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); if (settingsSaving) return;
  const panel=document.querySelector('[data-settings-panel="'+activeSettingsGroup+'"]');
  for(const input of panel.querySelectorAll('input'))if(!input.checkValidity()){selectSettingsGroup(input.closest('[data-settings-panel]').dataset.settingsPanel);input.reportValidity();return;}
  const value = Object.fromEntries(settingKeys.filter(key=>panel.contains($('setting-'+key))).map(key=>[key,$('setting-'+key).value]));
  if(activeSettingsGroup==='cadence')value.cadencePowerRules={format:'glob',patterns:$('power-rules').value,...(state.settings.cadencePowerRules?.legacy?{legacy:state.settings.cadencePowerRules.legacy}:{})};
  settingsSaving = true; render(state);
  try {
    const result = await call('settings-save',{group:activeSettingsGroup,values:value});
    if(result?.ok) { dirtyGroups.delete(activeSettingsGroup);settingsDirty=dirtyGroups.size>0; notice(result.message); const updated=await call('state'); if(updated) render(updated); }
  } finally { settingsSaving=false; render(state); }
});
for (const id of ['plugin-path','plugin-path-local','plugin-path-login']) $(id).addEventListener('click', () => call('plugin-path').then(result => { if (result?.ok) notice(result.message); }));
$('clear').addEventListener('click', () => { $('clear-message').textContent = '确定清空清单中的 ' + state.queue.length + ' 个元件吗？'; $('clear-dialog').showModal(); });
$('clear-cancel').addEventListener('click', () => $('clear-dialog').close());
$('clear-confirm').addEventListener('click', () => { $('clear-dialog').close(); void call('clear'); });
$('url').addEventListener('focus', () => $('url').select());
$('url').addEventListener('blur', () => { $('url').value = state?.navigation?.url || ''; });
$('url').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); $('url').blur(); }
  if (e.key === 'Enter') {
    e.preventDefault(); const value = $('url').value.trim(); if (!value) return;
    const url = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : 'https://' + value;
    void call('navigate', url).then(result => { if (result?.ok) $('url').blur(); });
  }
});
window.hub.onState(render); call('state').then(s => { if (s) render(s); });

$('power-rules').addEventListener('input',()=>{markSettingsDirty('cadence');$('settings-hint').textContent='有未保存的修改，保存后生效。';$('power-test-result').textContent='';});
$('power-reset').addEventListener('click',()=>{$('power-rules').value=state.settings.cadencePowerDefaults?.patterns || '';state.settings.cadencePowerRules={format:'glob',patterns:$('power-rules').value};$('power-legacy-note').hidden=true;$('power-rules').dispatchEvent(new Event('input'));});
$('power-test').addEventListener('click',async()=>{
  try{const result=await call('power-rules-test',{rules:{format:'glob',patterns:$('power-rules').value,...(state.settings.cadencePowerRules?.legacy?{legacy:state.settings.cadencePowerRules.legacy}:{})},name:$('power-test-name').value});$('power-test-result').textContent=result?.ok?(result.matched?'名称匹配：可补充识别为 Power（原库类型仍优先）。':'名称不匹配：不自动改为 Power。'):(result?.message || '测试失败');}catch(e){$('power-test-result').textContent='规则无效：'+e.message;}
});
$('power-repair').addEventListener('click',async()=>{
  if(dirtyGroups.has('cadence')){notice('请先保存设置，再更新已有原理图库。');return;}
  const result=await call('cadence-repair-symbols');if(result?.ok)notice(result.message);
});

document.querySelectorAll('[data-setting-detect]').forEach(button=>button.addEventListener('click',async()=>{
  const key=button.dataset.settingDetect;toolDetectionBusy=true;render(state);button.textContent='正在检测…';
  try{const result=await call('settings-detect',key);if(result?.ok && result.path){$('setting-'+key).value=result.path;markSettingsDirty($('setting-'+key).closest('[data-settings-panel]').dataset.settingsPanel);render(state);notice(result.message);}}
  finally{toolDetectionBusy=false;button.textContent='自动检测';render(state);}
}));
