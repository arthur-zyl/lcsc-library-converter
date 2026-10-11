let currentProgress;
const stopButton = document.getElementById('stop-export');
window.exportProgress.onState(value => {
  currentProgress = value;
  document.getElementById('progress-count').textContent = value.phaseTotal?`本阶段 ${value.phaseCompleted || 0} / ${value.phaseTotal} · 清单共 ${value.total} 个`:`已处理 ${value.completed} / ${value.total}`;
  document.getElementById('progress-part').textContent = value.currentId || '批量任务';
  document.getElementById('progress-stage').textContent = value.stage;
  const bar = document.getElementById('export-progress');
  bar.max = 100; bar.value = value.percent ?? 35*value.completed/Math.max(value.total,1);
  stopButton.disabled = !value.requestId || value.stopRequested || !value.canStop;
  stopButton.textContent = value.stopRequested ? '正在中止…' : value.canStop ? '中止任务' : '正在保存结果…';
  document.getElementById('stop-hint').textContent = value.stopRequested ? '完成当前元件并清理后中止，已取得的结果会保留。' : '立创 EDA 操作已锁定，完成后自动恢复。';
});
stopButton.addEventListener('click', async () => {
  if (stopButton.disabled || !currentProgress?.requestId) return;
  stopButton.disabled = true;
  try {
    const result = await window.exportProgress.stop(currentProgress.requestId);
    if (!result.ok) document.getElementById('stop-hint').textContent = result.message;
  } catch { stopButton.disabled = false; document.getElementById('stop-hint').textContent = '中止请求未发送，请重试。'; }
});
