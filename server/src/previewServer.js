// server/src/previewServer.js
// Serves registered static-preview directories under /preview, reusing the system token via a cookie
// (a browser opening a URL can't send a Bearer header). Absolute-rooted assets (/assets/...) are
// served from the right preview dir via a Referer fallback (design's "方案 A").
// Dynamic ports and arbitrary websites are handled by the built-in browser instead.
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

// Resolve the on-disk file for a request path under a preview: '' or '<dir>/' → its index.html.
function fileFor(rest) { return (!rest || rest.endsWith('/')) ? `${rest}index.html` : rest; }

export function createPreview({
  previews,
  token,
}) {
  const router = express.Router();

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

  return { router, refererFallback };
}
