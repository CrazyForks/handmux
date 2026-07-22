// Preview registry routes: register a static dir OR a dynamic port, list, and remove. The url carries
// ?token= so the browser's first navigation sets the preview cookie. 503 when previews are disabled.
import express from 'express';
import { safePreviewName } from '../previews.js';

export function previewRoutes({ previews, token }) {
  const r = express.Router();

  // POST {name,dir} registers a static directory served at /preview/<name>/.
  r.post('/previews', async (req, res, next) => {
    if (!previews) return res.status(503).json({ error: 'previews disabled' });
    const { name, dir } = req.body || {};
    if (typeof name !== 'string' || !name || typeof dir !== 'string' || !dir) return res.status(400).json({ error: 'bad request' });
    try {
      const out = await previews.register({ name, dir });
      if (out.error) return res.status(out.status).json({ error: out.error });
      const url = `/preview/${encodeURIComponent(out.name)}/?token=${encodeURIComponent(token)}`;
      res.json({ name: out.name, kind: out.kind, url, expiresAt: out.expiresAt });
    } catch (e) { next(e); }
  });

  r.get('/previews', (req, res) => {
    if (!previews) return res.status(503).json({ error: 'previews disabled' });
    res.json({ previews: previews.list() });
  });

  r.delete('/previews/:name', (req, res) => {
    if (!previews) return res.status(503).json({ error: 'previews disabled' });
    if (!safePreviewName(req.params.name)) return res.status(400).json({ error: 'bad name' });
    previews.remove(req.params.name);
    res.status(204).end();
  });

  return r;
}
