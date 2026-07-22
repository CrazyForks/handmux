import http from 'node:http';
import net from 'node:net';

const SERVICE_PATHS = new Set([
  '/hammerhead.js',
  '/task.js',
  '/iframe-task.js',
  '/messaging',
  '/transport-worker.js',
  '/worker-hammerhead.js',
]);

export function isBrowserServicePath(pathname) {
  return SERVICE_PATHS.has(String(pathname || '').split('?')[0]);
}

function browserRequest(browser, req) {
  const pathname = String(req.url || '').split('?')[0];
  return isBrowserServicePath(pathname) || browser.ownsPublicPath(pathname);
}

function filteredCookie(raw) {
  const values = String(raw || '')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !value.startsWith('tw_preview='));
  return values.join('; ');
}

function upstreamHeaders(headers, port, token) {
  const out = { ...headers, host: `127.0.0.1:${port}` };
  if (token && out.authorization === `Bearer ${token}`) delete out.authorization;
  delete out['proxy-authorization'];
  if (out.cookie) {
    out.cookie = filteredCookie(out.cookie);
    if (!out.cookie) delete out.cookie;
  }
  return out;
}

export function createBrowserPublicProxy({
  browser,
  token,
  request = http.request,
  connect = net.connect,
} = {}) {
  const handler = (req, res, next) => {
    if (!browser || !browserRequest(browser, req)) return next();
    const port = browser.internalPorts[0];
    const upstream = request({
      hostname: '127.0.0.1',
      port,
      method: req.method,
      path: req.originalUrl || req.url,
      headers: upstreamHeaders(req.headers, port, token),
    }, (incoming) => {
      res.writeHead(incoming.statusCode || 502, incoming.headers);
      incoming.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.status(502).json({ error: 'browser proxy unavailable' });
      else res.destroy();
    });
    req.pipe(upstream);
  };

  const onUpgrade = (req, socket, head) => {
    if (!browser || !browserRequest(browser, req)) return false;
    const port = browser.internalPorts[0];
    const upstream = connect({ host: '127.0.0.1', port });
    upstream.once('connect', () => {
      const headers = upstreamHeaders(req.headers, port, token);
      const lines = [`${req.method || 'GET'} ${req.url} HTTP/${req.httpVersion || '1.1'}`];
      for (const [name, value] of Object.entries(headers)) {
        if (Array.isArray(value)) for (const item of value) lines.push(`${name}: ${item}`);
        else if (value != null) lines.push(`${name}: ${value}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.once('error', () => socket.destroy());
    socket.once('error', () => upstream.destroy());
    return true;
  };

  return { handler, onUpgrade };
}
