const { WebSocketServer, WebSocket } = require('ws');
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const DISCOVERY_PORT = 27361;
const DISCOVERY_PATH = '/component-hub/connection';
class Bridge extends EventEmitter {
  constructor() { super(); this.token = randomBytes(24).toString('hex'); this.discoveryKey = randomBytes(24).toString('hex'); this.client = null; this.active = null; this.authProbes = new Map(); this.loggedIn = null; this.pluginVersion = null; this.completion = null; }
  async start() {
    this.server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 256 * 1024,
      verifyClient: ({ req }) => { try { const token = new URL(req.url, 'http://localhost').searchParams.get('token') || ''; const a = Buffer.from(token), b = Buffer.from(this.token); return a.length === b.length && timingSafeEqual(a, b); } catch { return false; } } });
    await new Promise((resolve, reject) => { this.server.once('listening', resolve); this.server.once('error', reject); });
    this.uri = `ws://127.0.0.1:${this.server.address().port}/?token=${this.token}`;
    this.server.on('connection', client => {
      if (this.client) { client.close(1008, '已有连接'); return; }
      this.client = client; this.emit('state');
      client.on('message', bytes => { try { const m = JSON.parse(bytes.toString());
        if (!m || typeof m.type !== 'string') return;
        if (m.type === 'hello' || m.type === 'auth') {
          if(m.type==='hello')this.pluginVersion=typeof m.version==='string'?m.version:null;
          if (typeof m.loggedIn === 'boolean') this.loggedIn = m.loggedIn;
          if (m.type === 'auth' && this.authProbes.has(m.probeId)) { this.authProbes.get(m.probeId)(this.loggedIn); this.authProbes.delete(m.probeId); }
          this.emit('message', { ...m, message: m.type === 'hello' ? '立创 EDA 插件已连接' : '立创 EDA 登录状态已核对' }); this.emit('state'); return;
        }
        if (m.type === 'acknowledged') { if (m.requestId === this.completion?.requestId && !this.completion.acknowledged) { this.completion.acknowledged = true; this.emit('message', m); } return; }
        if (m.requestId !== this.active?.requestId) return;
        if (['progress', 'exported', 'failed'].includes(m.type)) {
          if (m.type === 'exported') this.completion = { requestId: m.requestId, acknowledged: false };
          this.emit('message', m); if (['exported', 'failed'].includes(m.type)) { this.active = null; this.emit('state'); }
        }
      } catch { this.emit('message', { type: 'invalid', message: '忽略无效通信消息' }); } });
      client.on('close', () => { this.client = null; this.loggedIn = null; this.pluginVersion=null; for (const resolve of this.authProbes.values()) resolve(null); this.authProbes.clear(); if (this.active) this.emit('message', { type: 'failed', requestId: this.active.requestId, message: '立创 EDA 连接中断；任务可能仍在立创 EDA 运行，请核对后再发送' }); this.active = null; this.emit('state'); });
    }); return this;
  }
  async startDiscovery(port = DISCOVERY_PORT) {
    this.discovery = http.createServer((req, res) => {
      const a = Buffer.from(String(req.headers['x-component-hub-key'] || '')), b = Buffer.from(this.discoveryKey);
      if (req.url !== DISCOVERY_PATH || a.length !== b.length || !timingSafeEqual(a, b)) { res.writeHead(403); res.end(); return; }
      // Only the app's embedded EDA WebContents receives this header from Electron.
      const origin = req.headers.origin;
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin'); res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'X-Component-Hub-Key');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ schema: 'component-hub-connection/v1', uri: this.uri }));
    });
    this.discovery.requestTimeout = 5000; this.discovery.headersTimeout = 5000;
    await new Promise((resolve, reject) => { this.discovery.once('listening', resolve); this.discovery.once('error', reject); this.discovery.listen(port, '127.0.0.1'); });
    return this.discovery.address().port;
  }
  send(ids,options={}) {
    if (this.active) throw new Error('已有导出任务运行中');
    if (!this.client || this.client.readyState !== WebSocket.OPEN) throw new Error('请先在立创 EDA 插件菜单中连接本应用');
    if(options.retainExportPcb===true){const version=/^(\d+)\.(\d+)\.(\d+)/.exec(this.pluginVersion||'');if(!version || Number(version[1])*1000000+Number(version[2])*1000+Number(version[3])<5007)throw new Error('保留调试 PCB 需要重新导入立创 EDA 连接插件 0.5.7 或更新版本。');}
    const unique = [...new Set(ids)]; if (!unique.length || unique.length > 50 || unique.some(x => !/^C[1-9]\d*$/.test(x))) throw new Error('每批需要 1–50 个有效 C 编号');
    this.completion = null; this.active = { requestId: randomUUID(), ids: unique, retainExportPcb:options.retainExportPcb===true };
    this.client.send(JSON.stringify({ type: 'export', ...this.active })); this.emit('state'); return this.active;
  }
  stop() {
    if (!this.active || this.active.stopRequested || this.client?.readyState !== WebSocket.OPEN) return false;
    this.client.send(JSON.stringify({ type: 'stop', requestId: this.active.requestId }));
    this.active.stopRequested = true; this.emit('state'); return true;
  }
  checkLogin() { if (!this.client || this.client.readyState !== WebSocket.OPEN) return Promise.resolve(null); return new Promise(resolve => { const probeId = randomUUID(); const timer = setTimeout(() => { this.authProbes.delete(probeId); resolve(null); }, 4000); this.authProbes.set(probeId, value => { clearTimeout(timer); resolve(value); }); this.client.send(JSON.stringify({ type: 'check-auth', probeId })); }); }
  status() { return { connected: !!this.client, active: this.active, uri: this.uri, loggedIn: this.loggedIn,version:this.pluginVersion }; }
  close() { this.client?.terminate(); this.server?.close(); this.discovery?.close(); }
}
module.exports = { Bridge, DISCOVERY_PORT, DISCOVERY_PATH };
