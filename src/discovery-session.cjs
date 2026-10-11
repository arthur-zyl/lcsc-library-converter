const { DISCOVERY_PORT, DISCOVERY_PATH } = require('./bridge.cjs');
function attachDiscovery(edaContents, bridge, port = DISCOVERY_PORT) {
  const url = `http://127.0.0.1:${port}${DISCOVERY_PATH}`;
  edaContents.session.webRequest.onBeforeSendHeaders({ urls: [url] }, (details, callback) => {
    const headers = { ...details.requestHeaders };
    for (const name of Object.keys(headers)) if (name.toLowerCase() === 'x-component-hub-key') delete headers[name];
    if (details.webContentsId === edaContents.id && /^https:\/\/([\w-]+\.)*lceda\.cn(?:\/|$)/.test(edaContents.getURL())) headers['X-Component-Hub-Key'] = bridge.discoveryKey;
    callback({ requestHeaders: headers });
  });
  return url;
}
module.exports = { attachDiscovery };
