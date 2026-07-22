import express from 'express';
import { browserRequestOrigin } from './publicProxy.js';

const CLOSE_AFTER_MINUTES = new Set([10, 30, 60, 120, null]);
const DEVICE_ID = /^[A-Za-z0-9_-]{32,128}$/;
const DEVICE_COOKIE = 'tw_browser_device';

function previewOrigin(raw) {
  if (!raw) return null;
  const value = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('previewDomain must use http or https');
  return url.origin;
}

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

export function browserRoutes({ browser, previewDomain = null, browserBootstrap = null }) {
  const r = express.Router();
  const publicOrigin = previewOrigin(previewDomain);
  if (publicOrigin && !browserBootstrap) throw new Error('browser bootstrap required with previewDomain');
  const publicTab = (tab, deviceId) => {
    if (!publicOrigin || !tab?.url) return tab;
    return { ...tab, url: browserBootstrap.issue({ url: tab.url, origin: publicOrigin, deviceId }) };
  };

  r.use('/browser-tabs', (req, res, next) => {
    const deviceId = req.get('x-handmux-browser-device');
    if (!DEVICE_ID.test(deviceId || '')) return res.status(400).json({ error: 'browser device id required' });
    req.browserDeviceId = deviceId;
    const origin = publicOrigin || browserRequestOrigin(req);
    const secure = origin.startsWith('https://') ? '; Secure' : '';
    res.append('Set-Cookie', `${DEVICE_COOKIE}=${deviceId}; Path=/; HttpOnly; SameSite=Strict${secure}`);
    next();
  });

  r.post('/browser-tabs', async (req, res, next) => {
    if (!browser) return res.status(503).json({ error: 'browser unavailable' });
    const { url, closeAfterMinutes } = req.body || {};
    if (!validTarget(url)) return res.status(400).json({ error: 'browser URL must use http or https' });
    if (!validCloseAfter(closeAfterMinutes)) return res.status(400).json({ error: 'unsupported background close time' });
    try {
      const origin = publicOrigin || browserRequestOrigin(req);
      const tab = await browser.create({ url, origin, closeAfterMinutes, deviceId: req.browserDeviceId });
      res.status(201).json(publicTab(tab, req.browserDeviceId));
    } catch (error) { next(error); }
  });

  r.get('/browser-tabs', (req, res) => {
    if (!browser) return res.status(503).json({ error: 'browser unavailable' });
    res.json({ tabs: browser.list(req.browserDeviceId).map((tab) => publicTab(tab, req.browserDeviceId)) });
  });

  r.patch('/browser-tabs/:id/visibility', (req, res) => {
    if (!browser) return res.status(503).json({ error: 'browser unavailable' });
    const { visible, closeAfterMinutes } = req.body || {};
    if (typeof visible !== 'boolean' || !validCloseAfter(closeAfterMinutes)) {
      return res.status(400).json({ error: 'bad visibility request' });
    }
    const tab = browser.setVisible(req.params.id, visible, closeAfterMinutes, req.browserDeviceId);
    if (!tab) return res.status(404).json({ error: 'browser tab not found' });
    res.json(publicTab(tab, req.browserDeviceId));
  });

  r.post('/browser-tabs/:id/navigate', (req, res, next) => {
    if (!browser) return res.status(503).json({ error: 'browser unavailable' });
    const { url } = req.body || {};
    if (!validTarget(url)) return res.status(400).json({ error: 'browser URL must use http or https' });
    try {
      const tab = browser.navigate(req.params.id, url, req.browserDeviceId);
      if (!tab) return res.status(404).json({ error: 'browser tab not found' });
      res.json(publicTab(tab, req.browserDeviceId));
    } catch (error) { next(error); }
  });

  r.delete('/browser-tabs/:id', (req, res) => {
    if (!browser) return res.status(503).json({ error: 'browser unavailable' });
    const tab = browser.closeTab(req.params.id, req.browserDeviceId);
    if (!tab) return res.status(404).json({ error: 'browser tab not found' });
    res.status(204).end();
  });

  return r;
}
