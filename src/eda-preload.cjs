const { ipcRenderer } = require('electron');
let last;
function inspectLogin() {
  const visible = node => { const r = node.getBoundingClientRect(), s = getComputedStyle(node); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const buttons = [...document.querySelectorAll('button,a,[role="button"],span')];
  const loggedOut = buttons.some(node => visible(node) && /^(?:登录|立即登录|登录\/注册|登录账号|账号登录|手机号登录|扫码登录)$/.test(node.textContent.trim()));
  const value = loggedOut ? 'signed-out' : 'unknown';
  if (value !== last) { last = value; ipcRenderer.send('eda:login', value); }
}
window.addEventListener('DOMContentLoaded', () => {
  inspectLogin(); setInterval(inspectLogin, 2500);
});
