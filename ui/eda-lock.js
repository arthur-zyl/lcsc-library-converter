const t=(...args)=>window.i18n.t(...args);
window.i18n.apply(document);
let currentProgress;
const stopButton = document.getElementById('stop-export');
window.exportProgress.onState(value => {
  if(value.locale)window.i18n.setLocale(value.locale,document);
  currentProgress = value;
  document.getElementById('progress-count').textContent = value.phaseTotal?t("本阶段 {0} / {1} · 清单共 {2} 个",value.phaseCompleted || 0,value.phaseTotal,value.total):t("已处理 {0} / {1}",value.completed,value.total);
  document.getElementById('progress-part').textContent = value.currentId || t("批量任务");
  document.getElementById('progress-stage').textContent = t(value.stage);
  const bar = document.getElementById('export-progress');
  bar.max = 100; bar.value = value.percent ?? 35*value.completed/Math.max(value.total,1);
  stopButton.disabled = !value.requestId || value.stopRequested || !value.canStop;
  stopButton.textContent = value.stopRequested ? t("正在中止…") : value.canStop ? t("中止任务") : t("正在保存结果…");
  document.getElementById('stop-hint').textContent = value.stopRequested ? t("完成当前元件并清理后中止，已取得的结果会保留。") : t("立创 EDA 操作已锁定，完成后自动恢复。");
});
stopButton.addEventListener('click', async () => {
  if (stopButton.disabled || !currentProgress?.requestId) return;
  stopButton.disabled = true;
  try {
    const result = await window.exportProgress.stop(currentProgress.requestId);
    if (!result.ok) document.getElementById('stop-hint').textContent = t(result.message);
  } catch { stopButton.disabled = false; document.getElementById('stop-hint').textContent = t("中止请求未发送，请重试。"); }
});
