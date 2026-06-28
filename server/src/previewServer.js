// server/src/previewServer.js
// Serves registered static-preview directories under /preview, reusing the system token via a cookie
// (a browser opening a URL can't send a Bearer header). Absolute-rooted assets (/assets/...) are
// served from the right preview dir via a Referer fallback (design's "方案 A").
// Also handles dynamic preview: Host-based dispatch to loopback ports (HTTP + WS upgrade).
import net from 'node:net';
import http from 'node:http';
import express from 'express';
import { tokenEquals } from './auth.js';
import { safePreviewName } from './previews.js';

const COOKIE = 'tw_preview';

// Read one cookie value from a raw Cookie header, URL-decoded. No cookie-parser dep (zero-dep house style).
export function parseCookie(header, name) {
  if (!header) return null;
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(header);
  return m ? decodeURIComponent(m[1]) : null;
}

// Credential check shared by the /preview gate AND the referer fallback. Accepts the token via
// ?token= (first visit) or the tw_preview cookie (subsequent). timing-safe via tokenEquals.
export function credOk(req, token) {
  const q = req.query?.token;
  const provided = (typeof q === 'string' && q) ? q : parseCookie(req.headers?.cookie, COOKIE);
  if (!provided) return false;
  try { return tokenEquals(provided, token); } catch { return false; }
}

export { COOKIE };

// A preview host is exactly `<name>.<domain>` where <name> is one safe label. Anything deeper, the
// base domain itself, or a foreign domain → not ours (null). domain unset → dynamic disabled → null.
// The configured domain may carry a :port (the edge runs on a non-standard port, e.g. :39999) — that
// port belongs in the browser URL, but Host matching is hostname-only, so strip it here. The incoming
// `host` already has its port stripped by the caller.
export function isPreviewHost(host, domain) {
  if (!domain || !host) return null;
  const base = domain.split(':')[0];
  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null; // single label only
  return safePreviewName(label);
}

// Cookie scope = base domain minus its first label (preview.example.com → example.com) so the token
// cookie set on a preview subdomain is also sent to the main app and every sibling preview. A cookie
// Domain attribute can't carry a port, so strip any :port from the configured domain first.
function cookieScope(domain) {
  if (!domain) return null;
  const base = domain.split(':')[0];
  const dot = base.indexOf('.');
  return dot === -1 ? base : base.slice(dot + 1);
}

// Resolve the on-disk file for a request path under a preview: '' or '<dir>/' → its index.html.
function fileFor(rest) { return (!rest || rest.endsWith('/')) ? `${rest}index.html` : rest; }

export function createPreview({ previews, token, domain = null }) {
  const router = express.Router();
  const cookieDomain = cookieScope(domain);

  // Gate: ?token= (set cookie + 302 strip) OR a valid cookie; else 401.
  router.use((req, res, next) => {
    const q = req.query?.token;
    if (typeof q === 'string' && q && credOk(req, token)) {
      res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`);
      const u = new URL(req.originalUrl, 'http://x');
      u.searchParams.delete('token');
      return res.redirect(302, u.pathname + u.search);
    }
    if (!credOk(req, token)) return res.status(401).send('unauthorized');
    next();
  });

  function serve(name, rest, res) {
    const { state, entry } = previews.get(name);
    if (state === 'missing') return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><h1>预览不存在</h1>');
    if (state === 'expired') return res.status(410).type('html').send('<!doctype html><meta charset="utf-8"><h1>预览已过期</h1><p>请回到 app 重新启动预览。</p>');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(fileFor(rest), { root: entry.dir, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) res.status(err.statusCode || 404).end();
    });
  }

  // /:name catches both '/live' (no trailing slash → redirect) and '/live/' (trailing slash → serve root).
  // /:name/* catches '/live/index.html', '/live/assets/x.js', etc.
  router.get('/:name', (req, res, next) => {
    if (req.url.endsWith('/')) return serve(req.params.name, '', res);
    res.redirect(301, `/preview/${encodeURIComponent(req.params.name)}/`);
  });
  router.get('/:name/*', (req, res) => serve(req.params.name, req.params[0], res));

  // Referer fallback (mount AFTER /preview, BEFORE express.static): an absolute /assets/... request
  // whose Referer is a preview page is served from that preview's dir. Reuses credOk so it can never
  // read a dir without a valid token/cookie. Misses fall through to the normal static/SPA layer.
  function refererFallback(req, res, next) {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/preview')) return next();
    const ref = req.headers.referer;
    if (!ref) return next();
    let refPath;
    try { refPath = new URL(ref).pathname; } catch { return next(); }
    const m = /^\/preview\/([^/]+)\//.exec(refPath);
    if (!m) return next();
    if (!credOk(req, token)) return next();
    const { state, entry } = previews.get(decodeURIComponent(m[1]));
    if (state !== 'active') return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(req.path, { root: entry.dir, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) next();
    });
  }

  // Reverse-proxy one request to the dynamic preview's loopback port. No prefix strip — the app owns
  // its own root, so path/method/headers/body forward as-is. `host` is the loopback family the app was
  // found on at register time ('127.0.0.1' or '::1'); the Host header stays 127.0.0.1:<port> so a dev
  // server's host check (e.g. Vite, whose allowedHosts include localhost/127.0.0.1) is satisfied.
  function proxyHttp(port, host, req, res) {
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    const up = http.request({ host: host || '127.0.0.1', port, method: req.method, path: req.url, headers }, (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.on('error', () => res.destroy()); // mid-stream upstream reset (after headers) → tear down the client socket
      upRes.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.status(502).type('text').end('preview upstream error'); });
    req.pipe(up);
  }

  // Host-based dispatch middleware. Mount FIRST (before /api). A non-preview Host just calls next() →
  // the request falls through to the existing app, zero impact.
  function dynamicProxy(req, res, next) {
    const host = (req.headers.host || '').split(':')[0];
    const name = isPreviewHost(host, domain);
    if (!name) return next();
    const q = req.query?.token;
    if (typeof q === 'string' && q && credOk(req, token)) {
      const scope = cookieDomain ? `; Domain=${cookieDomain}` : '';
      res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}${scope}; Path=/; HttpOnly; SameSite=Lax`);
      const u = new URL(req.originalUrl, 'http://x');
      u.searchParams.delete('token');
      return res.redirect(302, u.pathname + u.search);
    }
    if (!credOk(req, token)) return res.status(401).send('unauthorized');
    const { state, entry } = previews.get(name);
    if (state === 'missing') return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><h1>预览不存在</h1>');
    if (state === 'expired') return res.status(410).type('html').send('<!doctype html><meta charset="utf-8"><h1>预览已过期</h1><p>请回到 app 重新启动预览。</p>');
    if (entry.kind !== 'dynamic') return res.status(404).end(); // a static name reached via subdomain — not served here
    proxyHttp(entry.port, entry.host, req, res);
  }

  // WebSocket (and any raw Upgrade) for a dynamic preview: same cookie auth, then a bare TCP pipe to
  // the loopback port — covers HMR, SSE-over-ws, and an app's own websockets. Wired via
  // server.on('upgrade'). A non-preview host or failed auth just destroys the socket (the app has no
  // other ws endpoints).
  function onUpgrade(req, socket, head) {
    const host = (req.headers.host || '').split(':')[0];
    const name = isPreviewHost(host, domain);
    if (!name) return socket.destroy();
    // ws handshakes rarely carry ?token=; the Domain-scoped cookie set on the first HTTP load is what
    // authorizes them. Build a minimal req-shape for credOk (query parsed from the URL for parity).
    let query = {};
    try { query = Object.fromEntries(new URL(req.url, 'http://x').searchParams); } catch { /* none */ }
    if (!credOk({ query, headers: req.headers }, token)) return socket.destroy();
    const { state, entry } = previews.get(name);
    if (state !== 'active' || entry.kind !== 'dynamic') return socket.destroy();
    const up = net.connect(entry.port, entry.host || '127.0.0.1', () => {
      const fwd = { ...req.headers, host: `127.0.0.1:${entry.port}` };
      up.write(`GET ${req.url} HTTP/1.1\r\n`);
      for (const [k, v] of Object.entries(fwd)) up.write(`${k}: ${v}\r\n`);
      up.write('\r\n');
      if (head && head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  }

  return { router, refererFallback, dynamicProxy, onUpgrade };
}
