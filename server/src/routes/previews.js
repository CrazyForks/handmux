// Preview registry routes: register a static dir OR a dynamic port, list, and remove. The url carries
// ?token= so the browser's first navigation sets the preview cookie. 503 when previews are disabled.
import express from 'express';
import { safePreviewName } from '../previews.js';

export function previewRoutes({ previews, previewDomain, token }) {
  const r = express.Router();

  // POST {name,dir} registers a static dir served at /preview/<name>/; POST {name,port} registers a
  // dynamic reverse-proxy reachable at https://<name>.<DOMAIN>/ (only when previewDomain is set).
  r.post('/previews', async (req, res, next) => {
    if (!previews) return res.status(503).json({ error: 'previews disabled' });
    const { name, dir, port, protocol } = req.body || {};
    if (typeof name !== 'string' || !name) return res.status(400).json({ error: 'bad request' });
    const hasPort = port !== undefined && port !== null && port !== '';
    if (!hasPort && (typeof dir !== 'string' || !dir)) return res.status(400).json({ error: 'bad request' });
    try {
      const dynamic = { name, port };
      if (protocol !== undefined) dynamic.protocol = protocol;
      const out = await previews.register(hasPort ? dynamic : { name, dir });
      if (out.error) return res.status(out.status).json({ error: out.error });
      const url = out.kind === 'dynamic'
        ? `https://${encodeURIComponent(out.name)}.${previewDomain}/?token=${encodeURIComponent(token)}`
        : `/preview/${encodeURIComponent(out.name)}/?token=${encodeURIComponent(token)}`;
      res.json({ name: out.name, kind: out.kind, url, expiresAt: out.expiresAt });
    } catch (e) { next(e); }
  });

  r.get('/previews', (req, res) => {
    if (!previews) return res.status(503).json({ error: 'previews disabled' });
    res.json({ previews: previews.list(), dynamicEnabled: !!previewDomain, domain: previewDomain });
  });

  r.delete('/previews/:name', (req, res) => {
    if (!previews) return res.status(503).json({ error: 'previews disabled' });
    if (!safePreviewName(req.params.name)) return res.status(400).json({ error: 'bad name' });
    previews.remove(req.params.name);
    res.status(204).end();
  });

  return r;
}
