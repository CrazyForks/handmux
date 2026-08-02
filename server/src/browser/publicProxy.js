import http from 'node:http';
import net from 'node:net';
import { isBrowserBootstrapPath } from './bootstrap.js';
import { classifyIp } from './targetPolicy.js';

const SERVICE_PATHS = new Set([
  '/hammerhead.js',
  '/task.js',
  '/iframe-task.js',
  '/messaging',
  '/transport-worker.js',
  '/worker-hammerhead.js',
]);
const DEVICE_COOKIE = 'tw_browser_device';

export function isBrowserServicePath(pathname) {
  return SERVICE_PATHS.has(String(pathname || '').split('?')[0]);
}

function cookieValue(raw, name) {
  for (const part of String(raw || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function browserTarget(browser, req, deviceId) {
  const pathname = String(req.url || '').split('?')[0];
  if (!claimedBrowserRequest(req)) return null;
  if (typeof browser.resolvePublicRequest === 'function') {
    return browser.resolvePublicRequest(pathname, deviceId, browserRequestOrigin(req));
  }
  const allowed = isBrowserServicePath(pathname) ? browser.hasDevice(deviceId) : browser.ownsPublicPath(pathname, deviceId);
  return allowed ? { port: browser.internalPorts[0] } : null;
}

function isLoopback(address) {
  return classifyIp(address) === 'loopback';
}

export function browserRequestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = isLoopback(req.socket?.remoteAddress) && (forwardedProto === 'http' || forwardedProto === 'https')
    ? forwardedProto
    : (req.socket?.encrypted ? 'https' : 'http');
  const host = req.headers.host;
  if (!host) return null;
  try { return new URL(`${protocol}://${host}`).origin; } catch { return null; }
}

export function claimedBrowserRequest(req) {
  const pathname = String(req.url || '').split('?')[0];
  return isBrowserBootstrapPath(pathname)
    || isBrowserServicePath(pathname)
    || String(pathname).split('/')[1]?.startsWith('_browser-');
}

function filteredCookie(raw) {
  const values = String(raw || '')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !value.startsWith('tw_preview=') && !value.startsWith(`${DEVICE_COOKIE}=`));
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
  browserBootstrap,
  token,
  request = http.request,
  connect = net.connect,
} = {}) {
  const handler = (req, res, next) => {
    if (!browser) return next();
    const pathname = String(req.url || '').split('?')[0];
    if (isBrowserBootstrapPath(pathname)) {
      const origin = browserRequestOrigin(req);
      const bootstrap = browserBootstrap?.consume(pathname, origin);
      if (!bootstrap) return res.status(403).json({ error: 'browser bootstrap unavailable' });
      const secure = origin?.startsWith('https://') ? '; Secure' : '';
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Set-Cookie', `${DEVICE_COOKIE}=${bootstrap.deviceId}; Path=/; HttpOnly; SameSite=Strict${secure}`);
      return res.redirect(
        bootstrap.preserveMethod ? (bootstrap.redirectStatus || 307) : 302,
        bootstrap.url,
      );
    }
    const deviceId = cookieValue(req.headers.cookie, DEVICE_COOKIE);
    const target = browserTarget(browser, req, deviceId);
    if (!target) {
      if (claimedBrowserRequest(req)) return res.status(403).json({ error: 'browser session unavailable' });
      return next();
    }
    const { port } = target;
    const upstream = request({
      hostname: '127.0.0.1',
      port,
      method: req.method,
      path: req.originalUrl || req.url,
      headers: upstreamHeaders(req.headers, port, token),
    }, (incoming) => {
      res.writeHead(incoming.statusCode || 502, incoming.headers);
      incoming.pipe(res);
      res.once('close', () => { if (!res.writableEnded) incoming.destroy(); });
    });
    const abort = () => upstream.destroy();
    req.once('aborted', abort);
    res.once('close', () => { if (!res.writableEnded) abort(); });
    upstream.on('error', () => {
      if (res.destroyed) return;
      if (!res.headersSent) res.status(502).json({ error: 'browser proxy unavailable' });
      else res.destroy();
    });
    req.pipe(upstream);
  };

  const onUpgrade = (req, socket, head) => {
    const deviceId = cookieValue(req.headers.cookie, DEVICE_COOKIE);
    const target = browser && browserTarget(browser, req, deviceId);
    if (!target) return false;
    const { port } = target;
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
