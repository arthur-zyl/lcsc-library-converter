const t=(...args)=>window.i18n.t(...args);
window.i18n.apply(document);
const modal = document.querySelector('dialog');
let result;
window.exportResult.onState(value => {
  if(value.locale)window.i18n.setLocale(value.locale,document);
  result = value;
  document.getElementById('result-log').hidden = !value.logPath;
  document.getElementById('result-title').textContent = t(value.title);
  document.getElementById('result-detail').textContent = t(value.detail);
  document.getElementById('result-stay').hidden = value.failed;
  document.getElementById('result-confirm').textContent = t(value.confirmLabel) || (value.failed ? t("确定") : t("确认"));
  document.getElementById('result-stay').textContent = t(value.stayLabel) || t("关闭");
  if (!modal.open) modal.showModal();
  document.getElementById('result-confirm').focus();
});
function choose(choice) { if (!result) return; modal.close(); window.exportResult.choose(result.id, choice); result = undefined; }
document.getElementById('result-confirm').addEventListener('click', () => choose('confirm'));
document.getElementById('result-stay').addEventListener('click', () => choose('stay'));
modal.addEventListener('cancel', event => { event.preventDefault(); choose('stay'); });

document.getElementById('result-log').addEventListener('click', () => { if(result)window.exportResult.choose(result.id, 'log'); });
