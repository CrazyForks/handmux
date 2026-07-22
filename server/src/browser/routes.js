import express from 'express';

const CLOSE_AFTER_MINUTES = new Set([10, 30, 60, 120, null]);

function validCloseAfter(value) {
  return CLOSE_AFTER_MINUTES.has(value);
}

function validTarget(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function requestOrigin(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : req.protocol;
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host');
  return `${protocol}://${host}`;
}

export function browserRoutes({ browser }) {
  const r = express.Router();

  r.post('/browser-tabs', (req, res, next) => {
    if (!browser) return res.status(503).json({ error: 'browser unavailable' });
    const { url, closeAfterMinutes } = req.body || {};
    if (!validTarget(url)) return res.status(400).json({ error: 'browser URL must use http or https' });
    if (!validCloseAfter(closeAfterMinutes)) return res.status(400).json({ error: 'unsupported background close time' });
    try {
      const tab = browser.create({ url, origin: requestOrigin(req), closeAfterMinutes });
      res.status(201).json(tab);
    } catch (error) { next(error); }
  });

  r.get('/browser-tabs', (_req, res) => {
    if (!browser) return res.status(503).json({ error: 'browser unavailable' });
    res.json({ tabs: browser.list() });
  });

  r.patch('/browser-tabs/:id/visibility', (req, res) => {
    if (!browser) return res.status(503).json({ error: 'browser unavailable' });
    const { visible, closeAfterMinutes } = req.body || {};
    if (typeof visible !== 'boolean' || !validCloseAfter(closeAfterMinutes)) {
      return res.status(400).json({ error: 'bad visibility request' });
    }
    const tab = browser.setVisible(req.params.id, visible, closeAfterMinutes);
    if (!tab) return res.status(404).json({ error: 'browser tab not found' });
    res.json(tab);
  });

  r.post('/browser-tabs/:id/navigate', (req, res, next) => {
    if (!browser) return res.status(503).json({ error: 'browser unavailable' });
    const { url } = req.body || {};
    if (!validTarget(url)) return res.status(400).json({ error: 'browser URL must use http or https' });
    try {
      const tab = browser.navigate(req.params.id, url);
      if (!tab) return res.status(404).json({ error: 'browser tab not found' });
      res.json(tab);
    } catch (error) { next(error); }
  });

  r.delete('/browser-tabs/:id', (req, res) => {
    if (!browser) return res.status(503).json({ error: 'browser unavailable' });
    const tab = browser.closeTab(req.params.id);
    if (!tab) return res.status(404).json({ error: 'browser tab not found' });
    res.status(204).end();
  });

  return r;
}
