const { ipcRenderer } = require('electron');
const entries = new Map();
let queue = new Set(), timer, locale='zh-CN';
const CART = /^(?:加入购物车|加入购物篮|加购物车|加购|AddtoCart)$/i;
const SELECTOR = 'button,a,input[type="button"],input[type="submit"],[role="button"],span,div';
const label = node => (node.value || node.textContent || '').replace(/[\s＋+]/g, '').trim();
function findCarts(scope) {
  const interactive = 'button,a,input,[role="button"]';
  const found = [...new Set([...scope.querySelectorAll(SELECTOR)]
    .filter(n => !n.closest('[data-eda-resource-button],[data-eda-resource-host]') && CART.test(label(n)))
    .map(n => n.closest(interactive) || n.querySelector(interactive) || n))].filter(n => CART.test(label(n)));
  return [...scope.querySelectorAll('[data-eda-resource-button]'), ...found.filter(n => !found.some(other => other !== n && other.contains(n)))];
}
function ids(text) {
  const marked = [...text.matchAll(/(?:商品编号|商城编号|立创编号|编号)\s*[:：]?\s*(C[1-9]\d*)\b/gi)].map(x => x[1].toUpperCase());
  return [...new Set(marked.length ? marked : [...text.matchAll(/\bC[1-9]\d*\b/gi)].map(x => x[0].toUpperCase()))];
}
function product(scope, id, detail = false) {
  function field(names) {
    for (const node of scope.querySelectorAll('dt,th,label,span,div,p')) {
      if (!names.includes(node.textContent.trim().replace(/[:：]$/, ''))) continue;
      const value = node.nextElementSibling?.textContent?.trim(); if (value && value.length < 500) return value;
    }
    const content = scope.innerText || scope.textContent || '';
    for (const name of names) { const value = content.match(new RegExp(name + '\\s*[:：]\\s*([^\\n\\r]+)')); if (value) return value[1].trim().slice(0, 500); }
    return '';
  }
  let record = {}, web = {};
  if (detail) { try { const data = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}');
    const candidate = data.props?.pageProps?.webData?.productRecord;
    if (candidate?.productCode === id) { record = candidate; web = data.props.pageProps.webData; }
  } catch {} }
  let structured = {};
  if (detail) for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { const data = JSON.parse(script.textContent); const list = Array.isArray(data) ? data : data['@graph'] || [data];
      const value = list.find(x => x['@type'] === 'Product' && x.sku === id); if (value) { structured = value; break; }
    } catch {}
  }
  const links = [...scope.querySelectorAll('a[href]')].filter(a => {
    try { const u = new URL(a.href, location.href); return u.hostname === 'item.szlcsc.com' && /^\/\d+\.html$/.test(u.pathname); } catch { return false; }
  });
  const canonical = a => { const u = new URL(a.href, location.href); return u.origin + u.pathname; };
  const urls = [...new Set(links.map(canonical))];
  const sameProduct = urls.length === 1 ? links.filter(a => canonical(a) === urls[0] && a.textContent.trim()) : [];
  const link = sameProduct.find(a => /^[A-Za-z\d][A-Za-z\d_.()+-]*$/.test(a.textContent.trim())) || sameProduct.at(-1);
  const picture = scope.querySelector('a[href*="item.szlcsc.com"] img, img[src*="/product/"], img[data-src*="/product/"]');
  const structuredImage = Array.isArray(structured.image) ? structured.image[0] : structured.image;
  return { id, name: String(record.productModel || structured.mpn || scope.querySelector('h1')?.textContent || link?.getAttribute('title') || link?.textContent || id).trim(),
    image: String(record.breviaryImageUrl || structuredImage || picture?.currentSrc || picture?.getAttribute('data-src') || picture?.src || ''),
    brand: record.brandName || record.productGradePlateName || structured.brand?.name || field(['品牌', '品牌名称']) || scope.querySelector('a[href*="/brand/"]')?.textContent?.trim() || '',
    package: [record.standard, record.encapsulationModel].find(value => value && value !== '-') || field(['商品封装', '封装']),
    summary: [record.productType, record.productName, record.productArrange].filter(Boolean).join(' / ') || sameProduct.filter(a => a !== link).map(a => a.textContent.trim()).find(value => value.length > 5) || '',
    description: record.remark || field(['描述']) || record.productIntro || '',
    category: record.productType || structured.category || field(['分类', '商品分类']),
    packaging: record.productArrange || field(['包装', '包装方式']), label: record.smtLabel || '',
    stock: Number(web.totalStockNumber ?? record.stockNumber ?? NaN),
    parameters: (web.paramList || []).map(p => ({ name: p.parameterName, value: p.parameterDetailValue || p.parameterValue })).filter(p => p.name && p.value),
    packSize: record.productMinEncapsulationNumber ? `${record.productMinEncapsulationNumber}${record.productUnit || '个'}/${record.productMinEncapsulationUnit || '包装'}` : '',
    url: detail ? location.href : urls.length === 1 ? urls[0] : '' };
}
function detailProduct() {
  if (location.hostname !== 'item.szlcsc.com' || !/^\/\d+\.html$/.test(location.pathname)) return null;
  // Detail recommendations can contain other C numbers; the page's own record identifies this product.
  let ownId;
  try { ownId = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}').props?.pageProps?.webData?.productRecord?.productCode; } catch {}
  const matches = ownId && /^C[1-9]\d*$/.test(ownId) ? [ownId] : ids(document.body?.innerText || document.body?.textContent || '');
  return matches.length === 1 ? product(document.body, matches[0], true) : null;
}
function resolve(cart) {
  let best;
  // Stop at the first multi-product container; never borrow a C number from another row.
  for (let scope = cart.parentElement; scope && scope !== document.body && scope !== document.documentElement; scope = scope.parentElement) {
    const matches = ids(scope.innerText || scope.textContent || '');
    if (matches.length > 1) break;
    if (findCarts(scope).length > 1) break;
    if (matches.length === 1) best = product(scope, matches[0], location.hostname === 'item.szlcsc.com' && /^\/\d+\.html$/.test(location.pathname));
  }
  return best || detailProduct();
}
function paint(entry) {
  const added = entry.item && queue.has(entry.item.id);
  const title = (locale==='zh-CN'?'加入导出清单':'Add to export list')+(entry.item?': '+entry.item.id:'');
  if (entry.button.title !== title) entry.button.title = title;
  const text = locale==='zh-CN'?(added?'已加入清单':'加入清单'):(added?'Added to list':'Add to list');
  if (entry.button.textContent !== text) entry.button.textContent = text;
  entry.button.disabled = !!added;
  entry.button.style.opacity = added ? '0.65' : entry.opacity;
  entry.button.style.cursor = added ? 'default' : 'pointer';
}
function scan() {
  for (const [button] of entries) if (!button.isConnected) entries.delete(button);
  for (const cart of findCarts(document)) {
    const prior = entries.get(cart);
    if (prior) { prior.item = resolve(cart); paint(prior); continue; }
    const item = resolve(cart), style = getComputedStyle(cart), rect = cart.getBoundingClientRect();
    const button = document.createElement('button'); button.type = 'button';
    button.className = cart.className; button.setAttribute('data-eda-resource-button', '');
    // A new element drops the merchant's direct/inline handlers. Keep its original place and geometry.
    button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;white-space:nowrap;';
    for (const key of ['marginTop','marginRight','marginBottom','marginLeft','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderStyle','borderColor','backgroundColor','backgroundImage','color','boxShadow','borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius','fontFamily','fontSize','fontWeight','lineHeight','verticalAlign','float','flex','alignSelf','position','top','left','right','bottom']) button.style[key] = style[key];
    if (rect.width) button.style.width = rect.width + 'px';
    button.style.height = Math.max(30, rect.height || 34) + 'px';
    const entry = { button, item, opacity: style.opacity }; entries.set(button, entry); cart.replaceWith(button); paint(entry);
  }
}
// Capture before the site's delegated handlers, including clicks on newly rendered cart controls.
function guard(event) {
  if (event.type.startsWith('key') && !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  let button = target?.closest('[data-eda-resource-button]');
  if (!button) {
    const cart = findCarts(document).find(node => node === target || node.contains(target));
    if (cart) { event.preventDefault(); event.stopImmediatePropagation(); scan(); return; }
    return;
  }
  event.preventDefault(); event.stopImmediatePropagation();
  if (event.type === 'keydown' && !event.repeat && !button.disabled) { button.click(); return; }
  if (event.type !== 'click' || button.disabled) return;
  const fresh = resolve(button);
  if (!fresh) { ipcRenderer.send('shop:capture', { error: '无法确定此行的商品编号，请打开详情页后添加。' }); return; }
  const entry = entries.get(button); if (entry) entry.item = fresh;
  ipcRenderer.send('shop:capture', fresh);
}
for (const type of ['click','dblclick','pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','keydown','keyup']) window.addEventListener(type, guard, {capture:true,passive:false});
function schedule() { clearTimeout(timer); timer = setTimeout(scan, 150); }
function capture() {
  const item = detailProduct();
  if (!item) { ipcRenderer.send('shop:capture', { error: '请点击商品行旁的“加入清单”，或打开商品详情页。' }); return; }
  ipcRenderer.send('shop:capture', item);
}
ipcRenderer.on('shop:capture-request', capture);
ipcRenderer.on('shop:queue', (_event, values) => { queue = new Set(values); for (const entry of entries.values()) paint(entry); });
window.addEventListener('DOMContentLoaded', () => {
  if (!/(^|\.)(szlcsc|lcsc)\.com$/i.test(location.hostname)) return;
  scan(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
});

ipcRenderer.on('shop:locale',(_event,value)=>{locale=value==='zh-CN'?'zh-CN':'en';for(const entry of entries.values())paint(entry);});
