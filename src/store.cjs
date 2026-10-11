const fs = require('node:fs/promises');
const path = require('node:path');
function component(input) {
  const id = String(input.id || '').trim().toUpperCase();
  if (!/^C[1-9]\d*$/.test(id)) throw new Error('无效的立创 C 编号');
  let url = '';
  if (input.url) { const u = new URL(input.url); if (!/^https?:$/.test(u.protocol) || !isShop(u)) throw new Error('商品链接必须来自立创商城'); url = u.href; }
  let image = '';
  if (input.image) { try { const u = new URL(input.image); if (u.protocol === 'https:' && isShop(u)) image = u.href.slice(0, 2048); } catch {} }
  return { id, name: String(input.name || id).slice(0, 200), url, image,
    brand: String(input.brand || '').slice(0, 200), package: String(input.package || '').slice(0, 200),
    description: String(input.description || '').slice(0, 500), summary: String(input.summary || '').slice(0, 300),
    category: String(input.category || '').slice(0, 100), packaging: String(input.packaging || '').slice(0, 100),
    label: String(input.label || '').slice(0, 100), stock: Number.isFinite(input.stock) && input.stock >= 0 ? input.stock : null,
    packSize: String(input.packSize || '').slice(0, 100),
    parameters: (Array.isArray(input.parameters) ? input.parameters : []).slice(0, 40).filter(p => p && p.name && p.value).map(p => ({ name: String(p.name).slice(0, 80), value: String(p.value).slice(0, 200) })),
    addedAt: new Date().toISOString() };
}
function isShop(url) { return ['szlcsc.com', 'lcsc.com'].some(h => url.hostname === h || url.hostname.endsWith('.' + h)); }
class Store {
  constructor(root) { this.root = root; this.state = { queue: [], resources: [], freecadPython: '', setupShown:false }; this.pending = Promise.resolve(); }
  async init({ freshQueue = false } = {}) { await fs.mkdir(this.root, { recursive: true }); try { const value = JSON.parse(await fs.readFile(path.join(this.root, 'state.json'), 'utf8')); this.state = { ...this.state, ...value, queue: freshQueue ? [] : (value.queue || []).map(component) }; if(value.setupShown===undefined && value.setupCompleted===undefined)this.state.setupShown=true; } catch (e) { if (e.code !== 'ENOENT') throw new Error('资源库配置读取失败：' + e.message); } if (freshQueue) await this.persist(); return this; }
  persist() { const bytes = JSON.stringify(this.state, null, 2); this.pending = this.pending.then(async () => { const temp = path.join(this.root, 'state.json.tmp'); await fs.writeFile(temp, bytes); await fs.rename(temp, path.join(this.root, 'state.json')); }); return this.pending; }
  async add(input) { const item = component(input), prior = this.state.queue.find(x => x.id === item.id);
    if (prior) { for (const key of ['name', 'url', 'image', 'brand', 'package', 'description', 'summary', 'category', 'packaging', 'label', 'packSize']) if (item[key] && (key !== 'name' || item.name !== item.id)) prior[key] = item[key]; if (item.stock !== null) prior.stock = item.stock; if (item.parameters.length) prior.parameters = item.parameters; }
    else this.state.queue.push(item); await this.persist(); return prior || item; }
  async remove(id) { this.state.queue = this.state.queue.filter(x => x.id !== id); await this.persist(); }
  async removeMany(ids) { const done = new Set(ids); this.state.queue = this.state.queue.filter(x => !done.has(x.id)); await this.persist(); }
  async clearQueue() { this.state.queue = []; await this.persist(); }
}
module.exports = { component, isShop, Store };
