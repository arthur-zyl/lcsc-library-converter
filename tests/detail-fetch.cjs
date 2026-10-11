// Uses the same Chromium fetch API as the app to check the live metadata path.
const { app, session } = require('electron');
const path = require('node:path'); const { randomUUID } = require('node:crypto');
app.setPath('userData', path.join(app.getPath('temp'), 'hub-detail-test-' + randomUUID()));
const { parseDetails } = require('../src/product-details.cjs');
app.whenReady().then(async () => {
  for (const [id, productId] of [['C5137636','5747088'],['C2906982','3180495'],['C4990162','5565033'],['C5137565','5747017']]) {
  const response = await session.fromPartition('persist:component-hub-web').fetch(`https://item.szlcsc.com/${productId}.html`, { signal: AbortSignal.timeout(20000) });
  const chunks = []; for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
  const item = parseDetails(Buffer.concat(chunks).toString('utf8'), id, `https://item.szlcsc.com/${productId}.html`);
  if (!item.parameters.length || !item.package) throw new Error('Incomplete live metadata: ' + id);
  console.log('LIVE_DETAIL_OK ' + JSON.stringify({ id: item.id, package: item.package, parameters: item.parameters, packSize: item.packSize }));
  } app.quit();
}).catch(error => { console.error(error); app.exit(1); });
