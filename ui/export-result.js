const modal = document.querySelector('dialog');
let result;
window.exportResult.onState(value => {
  result = value;
  document.getElementById('result-log').hidden = !value.logPath;
  document.getElementById('result-title').textContent = value.title;
  document.getElementById('result-detail').textContent = value.detail;
  document.getElementById('result-stay').hidden = value.failed;
  document.getElementById('result-confirm').textContent = value.confirmLabel || (value.failed ? '确定' : '确认');
  document.getElementById('result-stay').textContent = value.stayLabel || '关闭';
  if (!modal.open) modal.showModal();
  document.getElementById('result-confirm').focus();
});
function choose(choice) { if (!result) return; modal.close(); window.exportResult.choose(result.id, choice); result = undefined; }
document.getElementById('result-confirm').addEventListener('click', () => choose('confirm'));
document.getElementById('result-stay').addEventListener('click', () => choose('stay'));
modal.addEventListener('cancel', event => { event.preventDefault(); choose('stay'); });

document.getElementById('result-log').addEventListener('click', () => { if(result)window.exportResult.choose(result.id, 'log'); });
