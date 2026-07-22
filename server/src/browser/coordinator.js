import { randomBytes } from 'node:crypto';
import { createBrowserSessionStore } from './sessionStore.js';
import { browserRequestOrigin } from './publicProxy.js';

const DEVICE_ID = /^[A-Za-z0-9_-]{32,128}$/;
const CLOSE_AFTER_MINUTES = new Set([10, 30, 60, 120, null]);
const DEVICE_COOKIE = 'tw_browser_device';

function targetUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}

function publicTab(tab) {
  if (!tab) return null;
  const { ownerDevice: _ownerDevice, ...out } = tab;
  return out;
}

function jsonBody(response) {
  if (!response?.body?.length) return null;
  try { return JSON.parse(response.body.toString('utf8')); } catch { return null; }
}

export function createBrowserCoordinator({
  previewDomain = null,
  proxyRequest,
  randomId = () => randomBytes(18).toString('base64url'),
  randomChannel = () => randomBytes(18).toString('base64url'),
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const direct = createBrowserSessionStore({ now, setTimer, clearTimer });
  const proxyIds = new Map(); // logical id -> current worker id; never used to synthesize worker list entries
  const proxyTabs = new Map(); // last worker-confirmed metadata, only for an atomic proxy -> direct transition
  const deviceQueues = new Map();
  const serializeDevice = async (deviceId, operation) => {
    const previous = deviceQueues.get(deviceId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    deviceQueues.set(deviceId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (deviceQueues.get(deviceId) === current) deviceQueues.delete(deviceId);
    }
  };

  const directFor = (id, deviceId) => {
    const tab = direct.get(id);
    return tab?.ownerDevice === deviceId ? tab : null;
  };
  const listDirect = (deviceId) => direct.list().filter((tab) => tab.ownerDevice === deviceId);
  const hideOtherDirect = (deviceId, exceptId) => {
    for (const tab of listDirect(deviceId)) {
      if (tab.id !== exceptId && tab.visible) direct.setVisible(tab.id, false, tab.closeAfterMinutes);
    }
  };
  const rememberProxy = (tab, logicalId = tab?.id, ownerDevice) => {
    if (!tab || !logicalId) return null;
    const workerId = tab.id;
    proxyIds.set(logicalId, workerId);
    const logical = { ...tab, id: logicalId, mode: 'proxy', ownerDevice };
    proxyTabs.set(logicalId, logical);
    return logical;
  };
  const forgetProxy = (logicalId) => {
    proxyIds.delete(logicalId);
    proxyTabs.delete(logicalId);
  };
  const forgetDeviceProxy = (deviceId) => {
    for (const [logicalId, tab] of proxyTabs) {
      if (tab.ownerDevice === deviceId) forgetProxy(logicalId);
    }
  };
  const reconcileProxy = (deviceId, workerTabs) => {
    const logicalForWorker = new Map();
    for (const [logicalId, internalId] of proxyIds) {
      if (proxyTabs.get(logicalId)?.ownerDevice === deviceId) logicalForWorker.set(internalId, logicalId);
    }
    const seen = new Set();
    const reconciled = workerTabs.map((tab) => {
      const logicalId = logicalForWorker.get(tab.id) || tab.id;
      seen.add(logicalId);
      return rememberProxy(tab, logicalId, deviceId);
    });
    for (const [logicalId, tab] of proxyTabs) {
      if (tab.ownerDevice === deviceId && !seen.has(logicalId)) forgetProxy(logicalId);
    }
    return reconciled;
  };
  const workerId = (logicalId) => proxyIds.get(logicalId) || logicalId;
  const proxyCall = async (req, method, path, body) => {
    return proxyRequest({ req, method, path, body });
  };
  const sendProxy = (res, response) => {
    if (!response) return res.status(503).json({ error: 'browser unavailable' });
    for (const [name, value] of Object.entries(response.headers || {})) {
      if (value != null && !['connection', 'content-length', 'transfer-encoding'].includes(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    }
    res.status(response.status).send(response.body);
  };
  const hideVisibleProxy = async (req, tabs) => {
    for (const tab of tabs) {
      if (!tab.visible) continue;
      const response = await proxyCall(req, 'PATCH', `/api/browser-tabs/${encodeURIComponent(workerId(tab.id))}/visibility`, {
        visible: false, closeAfterMinutes: tab.closeAfterMinutes,
      });
      if (!response) {
        forgetDeviceProxy(req.get('x-handmux-browser-device'));
        return { unavailable: true };
      }
      if (response.status === 404) {
        forgetDeviceProxy(req.get('x-handmux-browser-device'));
        return { stale: true };
      }
      const updated = jsonBody(response);
      if (response.status !== 200 || !updated) return { response };
      rememberProxy(updated, tab.id, req.get('x-handmux-browser-device'));
    }
    return { ok: true };
  };
  const addDirect = ({ id = randomId(), url, closeAfterMinutes, deviceId, channel = randomChannel() }) => {
    hideOtherDirect(deviceId, id);
    return direct.add({
      id, mode: 'direct', channel, url, originalUrl: url, title: '', closeAfterMinutes, ownerDevice: deviceId,
    });
  };
  const visibleSnapshot = (deviceId) => ({
    direct: listDirect(deviceId).filter((tab) => tab.visible),
    proxy: [...proxyTabs.values()]
      .filter((tab) => tab.ownerDevice === deviceId && tab.visible)
      .map((tab) => ({ ...tab, internalId: workerId(tab.id) })),
  });
  const restoreVisibleSnapshot = async (req, deviceId, snapshot) => {
    for (const tab of snapshot.direct) {
      if (directFor(tab.id, deviceId)) direct.setVisible(tab.id, true, tab.closeAfterMinutes);
    }
    for (const tab of snapshot.proxy) {
      const response = await proxyCall(
        req, 'PATCH', `/api/browser-tabs/${encodeURIComponent(tab.internalId)}/visibility`,
        { visible: true, closeAfterMinutes: tab.closeAfterMinutes },
      );
      if (!response) {
        forgetDeviceProxy(deviceId);
        continue;
      }
      if (response.status === 404) {
        forgetDeviceProxy(deviceId);
        continue;
      }
      const restored = jsonBody(response);
      if (response.status === 200 && restored) rememberProxy(restored, tab.id, deviceId);
    }
  };
  const createDirectTransaction = (req, deviceId) => {
    const snapshot = visibleSnapshot(deviceId);
    let preparePromise = null;
    let created = null;
    let rollbackPromise = null;
    return {
      prepare() {
        if (!preparePromise) preparePromise = hideVisibleProxy(req, snapshot.proxy);
        return preparePromise;
      },
      commit(input) {
        created = addDirect(input);
        return created;
      },
      rollback() {
        if (!rollbackPromise) rollbackPromise = (async () => {
          if (preparePromise) await preparePromise;
          if (created) direct.remove(created.id);
          await restoreVisibleSnapshot(req, deviceId, snapshot);
        })();
        return rollbackPromise;
      },
    };
  };

  const handleBrowserRequest = async (req, res, deviceId) => {
    const path = req.path || '/';
    const navigateMatch = path.match(/^\/([^/]+)\/navigate$/);
    const visibilityMatch = path.match(/^\/([^/]+)\/visibility$/);
    const tabMatch = path.match(/^\/([^/]+)$/);

    if (req.method === 'POST' && path === '/') {
      const { url: rawUrl, closeAfterMinutes, mode = 'proxy' } = req.body || {};
      const url = targetUrl(rawUrl);
      if (!url) return res.status(400).json({ error: 'browser URL must use http or https' });
      if (!CLOSE_AFTER_MINUTES.has(closeAfterMinutes)) return res.status(400).json({ error: 'unsupported background close time' });
      if (mode !== 'direct' && mode !== 'proxy') return res.status(400).json({ error: 'unsupported browser mode' });
      if (mode === 'proxy' && !previewDomain) return res.status(503).json({ error: 'browser proxy unavailable' });
      if (mode === 'direct') {
        let finished = false;
        let cancelled = req.aborted || res.destroyed;
        let responseSettled = false;
        let settleResponse;
        const responseDone = new Promise((resolve) => { settleResponse = resolve; });
        const settle = () => {
          if (responseSettled) return;
          responseSettled = true;
          settleResponse();
        };
        const transaction = createDirectTransaction(req, deviceId);
        const cancel = () => {
          if (finished) return;
          cancelled = true;
          void transaction.rollback().catch(() => {}).finally(settle);
        };
        req.once('aborted', cancel);
        res.once('close', cancel);
        res.once('finish', () => { finished = true; settle(); });
        const hidden = await transaction.prepare();
        cancelled ||= req.aborted || res.destroyed;
        if (cancelled) {
          await transaction.rollback();
          return undefined;
        }
        if (hidden.response) {
          const sent = sendProxy(res, hidden.response);
          await responseDone;
          return sent;
        }
        const created = transaction.commit({ url, closeAfterMinutes, deviceId });
        if (cancelled) {
          await transaction.rollback();
          return undefined;
        }
        const sent = res.status(201).json(publicTab(created));
        await responseDone;
        return sent;
      }
      const response = await proxyCall(req, 'POST', '/api/browser-tabs', { url, closeAfterMinutes, mode });
      const created = jsonBody(response);
      if (response?.status === 201 && created) {
        hideOtherDirect(deviceId, null);
        rememberProxy(created, created.id, deviceId);
      }
      return sendProxy(res, response);
    }

    if (req.method === 'GET' && path === '/') {
      const local = listDirect(deviceId);
      const response = await proxyCall(req, 'GET', '/api/browser-tabs');
      const payload = jsonBody(response);
      const workerTabs = response?.status === 200 && Array.isArray(payload?.tabs) ? payload.tabs : [];
      let confirmedProxy;
      if (response?.status === 200) confirmedProxy = reconcileProxy(deviceId, workerTabs);
      else {
        forgetDeviceProxy(deviceId);
        confirmedProxy = [];
      }
      const localVisible = local.some((tab) => tab.visible);
      if (localVisible) {
        const hidden = await hideVisibleProxy(req, confirmedProxy);
        if (hidden.response) {
          for (const tab of local) {
            if (tab.visible) direct.setVisible(tab.id, false, tab.closeAfterMinutes);
          }
        } else if (hidden.unavailable || hidden.stale) {
          confirmedProxy = [];
        } else {
          confirmedProxy = confirmedProxy.map((tab) => proxyTabs.get(tab.id) || tab);
        }
      }
      return res.json({ tabs: [...listDirect(deviceId).map(publicTab), ...confirmedProxy.map(publicTab)] });
    }

    if (req.method === 'POST' && navigateMatch) {
      const logicalId = decodeURIComponent(navigateMatch[1]);
      const { url: rawUrl, mode = 'proxy' } = req.body || {};
      const url = targetUrl(rawUrl);
      if (!url) return res.status(400).json({ error: 'browser URL must use http or https' });
      if (mode !== 'direct' && mode !== 'proxy') return res.status(400).json({ error: 'unsupported browser mode' });
      if (mode === 'proxy' && !previewDomain) return res.status(503).json({ error: 'browser proxy unavailable' });
      const local = directFor(logicalId, deviceId);
      if (local && mode === 'direct') {
        const updated = direct.update(logicalId, { url, originalUrl: url, title: '' });
        return res.json(publicTab(updated));
      }
      if (local && mode === 'proxy') {
        const response = await proxyCall(req, 'POST', '/api/browser-tabs', {
          url, closeAfterMinutes: local.closeAfterMinutes, mode: 'proxy',
        });
        const created = jsonBody(response);
        if (response?.status !== 201 || !created) return sendProxy(res, response);
        const logical = rememberProxy(created, logicalId, deviceId);
        direct.remove(logicalId);
        return res.status(200).json(publicTab(logical));
      }
      const cached = proxyTabs.get(logicalId);
      if (mode === 'direct') {
        if (!cached || cached.ownerDevice && cached.ownerDevice !== deviceId) {
          const refreshed = await proxyCall(req, 'GET', '/api/browser-tabs');
          const payload = jsonBody(refreshed);
          if (refreshed?.status !== 200) return sendProxy(res, refreshed);
          reconcileProxy(deviceId, payload?.tabs || []);
        }
        const current = proxyTabs.get(logicalId);
        if (!current || current.ownerDevice !== deviceId) return res.status(404).json({ error: 'browser tab not found' });
        if (direct.get(logicalId)) return res.status(409).json({ error: 'browser tab id conflict' });
        const staged = {
          id: logicalId, url, closeAfterMinutes: current.closeAfterMinutes, deviceId, channel: current.channel,
        };
        const internalId = workerId(logicalId);
        const removed = await proxyCall(req, 'DELETE', `/api/browser-tabs/${encodeURIComponent(internalId)}`);
        if (removed?.status !== 204) return sendProxy(res, removed);
        forgetProxy(logicalId);
        const created = addDirect(staged);
        return res.json(publicTab(created));
      }
      const internalId = workerId(logicalId);
      const response = await proxyCall(req, 'POST', `/api/browser-tabs/${encodeURIComponent(internalId)}/navigate`, { url, mode });
      const updated = jsonBody(response);
      if (response?.status === 200 && updated) {
        const logical = rememberProxy(updated, logicalId, deviceId);
        return res.json(publicTab(logical));
      }
      return sendProxy(res, response);
    }

    if (req.method === 'PATCH' && visibilityMatch) {
      const logicalId = decodeURIComponent(visibilityMatch[1]);
      const { visible, closeAfterMinutes } = req.body || {};
      if (typeof visible !== 'boolean' || !CLOSE_AFTER_MINUTES.has(closeAfterMinutes)) {
        return res.status(400).json({ error: 'bad visibility request' });
      }
      const local = directFor(logicalId, deviceId);
      if (local) {
        if (visible) {
          const hidden = await hideVisibleProxy(
            req, [...proxyTabs.values()].filter((tab) => tab.ownerDevice === deviceId),
          );
          if (hidden.response) return sendProxy(res, hidden.response);
          hideOtherDirect(deviceId, logicalId);
        }
        const updated = direct.setVisible(logicalId, visible, closeAfterMinutes);
        return res.json(publicTab(updated));
      }
      const response = await proxyCall(
        req, 'PATCH', `/api/browser-tabs/${encodeURIComponent(workerId(logicalId))}/visibility`, req.body,
      );
      const updated = jsonBody(response);
      if (response?.status === 200 && updated) {
        if (visible) hideOtherDirect(deviceId, null);
        return res.json(publicTab(rememberProxy(updated, logicalId, deviceId)));
      }
      return sendProxy(res, response);
    }

    if (req.method === 'DELETE' && tabMatch) {
      const logicalId = decodeURIComponent(tabMatch[1]);
      const local = directFor(logicalId, deviceId);
      if (local) {
        direct.remove(logicalId);
        return res.status(204).end();
      }
      const response = await proxyCall(req, 'DELETE', `/api/browser-tabs/${encodeURIComponent(workerId(logicalId))}`);
      if (response?.status === 204) forgetProxy(logicalId);
      return sendProxy(res, response);
    }

    return res.status(404).json({ error: 'browser tab not found' });
  };

  const browserCoordinator = async (req, res) => {
    const deviceId = req.get('x-handmux-browser-device');
    if (!DEVICE_ID.test(deviceId || '')) return res.status(400).json({ error: 'browser device id required' });
    const requestOrigin = browserRequestOrigin(req);
    const secure = requestOrigin.startsWith('https://') ? '; Secure' : '';
    res.append('Set-Cookie', `${DEVICE_COOKIE}=${deviceId}; Path=/; HttpOnly; SameSite=Strict${secure}`);

    return serializeDevice(deviceId, () => {
      if (req.aborted || res.destroyed) return undefined;
      return handleBrowserRequest(req, res, deviceId);
    });
  };
  browserCoordinator.close = () => direct.close();
  return browserCoordinator;
}
