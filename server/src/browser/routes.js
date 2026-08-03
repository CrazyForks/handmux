import express from 'express';
import { browserLabelForOrigin } from './originLabel.js';
import { browserRequestOrigin } from './publicProxy.js';
import { normalizeSiteVersion } from './siteVersion.js';

const RETENTION_DAYS = new Set([1, 7, 30, null]);
const DEVICE_ID = /^[A-Za-z0-9_-]{32,128}$/;
const TAB_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DEVICE_COOKIE = 'tw_browser_device';

function previewBase(raw) {
  if (!raw) return null;
  const value = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return new URL(value);
}

function wildcardOrigin(base, targetOrigin) {
  const url = new URL(base.origin);
  url.hostname = `${browserLabelForOrigin(targetOrigin)}.${base.hostname}`;
  return url.origin;
}

function normalizedTarget(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizedHttpOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function browserRoutes({
  browser,
  previewDomain = null,
  browserBootstrap = null,
}) {
  const router = express.Router();
  const publicBase = previewBase(previewDomain);

  router.use((req, res, next) => {
    const deviceId = req.get('x-handmux-browser-device');
    if (!DEVICE_ID.test(deviceId || '')) return res.status(400).json({ error: 'browser device id required' });
    req.browserDeviceId = deviceId;
    const origin = browserRequestOrigin(req);
    const secure = origin?.startsWith('https://') ? '; Secure' : '';
    res.append('Set-Cookie', `${DEVICE_COOKIE}=${deviceId}; Path=/; HttpOnly; SameSite=Strict${secure}`);
    next();
  });

  const responseLease = (lease, deviceId) => {
    if (!lease) return null;
    const url = browserBootstrap.issue({
      url: lease.url,
      origin: new URL(lease.url).origin,
      deviceId,
    });
    return { ...lease, url };
  };

  router.put('/leases/:tabId', async (req, res, next) => {
    if (!browser || !publicBase) return res.status(503).json({ error: 'browser proxy unavailable' });
    if (!TAB_ID.test(req.params.tabId)) return res.status(400).json({ error: 'bad browser tab id' });
    const url = normalizedTarget(req.body?.url);
    if (!url) return res.status(400).json({ error: 'browser URL must use http or https' });
    const siteVersion = normalizeSiteVersion(req.body?.siteVersion);
    if (!siteVersion) return res.status(400).json({ error: 'bad browser site version' });
    try {
      const origin = wildcardOrigin(publicBase, new URL(url).origin);
      const lease = await browser.putLease({
        tabId: req.params.tabId,
        url: req.body.url,
        origin,
        deviceId: req.browserDeviceId,
        siteVersion,
        sourceUserAgent: req.get('user-agent') || '',
      });
      return res.json(responseLease(lease, req.browserDeviceId));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/leases/:tabId/navigate', async (req, res, next) => {
    if (!browser || !publicBase) return res.status(503).json({ error: 'browser proxy unavailable' });
    if (!TAB_ID.test(req.params.tabId)) return res.status(400).json({ error: 'bad browser tab id' });
    const url = normalizedTarget(req.body?.url);
    if (!url) return res.status(400).json({ error: 'browser URL must use http or https' });
    const siteVersion = normalizeSiteVersion(req.body?.siteVersion);
    if (!siteVersion) return res.status(400).json({ error: 'bad browser site version' });
    try {
      const origin = wildcardOrigin(publicBase, new URL(url).origin);
      const lease = await browser.navigateLease(
        req.params.tabId,
        req.body.url,
        req.browserDeviceId,
        origin,
        siteVersion,
        req.get('user-agent') || '',
      );
      if (!lease) return res.status(404).json({ error: 'browser proxy lease not found' });
      return res.json(responseLease(lease, req.browserDeviceId));
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/leases/:tabId', (req, res) => {
    if (!browser) return res.status(503).json({ error: 'browser proxy unavailable' });
    if (!browser.deleteLease(req.params.tabId, req.browserDeviceId)) {
      return res.status(404).json({ error: 'browser proxy lease not found' });
    }
    return res.status(204).end();
  });

  router.put('/profile', async (req, res, next) => {
    const { persist, retentionDays } = req.body || {};
    if (typeof persist !== 'boolean' || !RETENTION_DAYS.has(retentionDays)) {
      return res.status(400).json({ error: 'bad browser profile preferences' });
    }
    try {
      return res.json(await browser.configureDeviceProfile(
        req.browserDeviceId,
        { persist, retentionDays },
      ));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/profile/clear', async (req, res, next) => {
    const rawOrigin = req.body?.origin;
    const origin = rawOrigin === null ? null : normalizedHttpOrigin(rawOrigin);
    if (origin === null && rawOrigin !== null) {
      return res.status(400).json({ error: 'bad browser profile clear request' });
    }
    try {
      return res.json(await browser.clearDeviceProfile(req.browserDeviceId, { origin }));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
