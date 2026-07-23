import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createBrowserCoordinator } from '../src/browser/coordinator.js';

const DEVICE_A = 'device_abcdefghijklmnopqrstuvwxyz123456';
const DEVICE_B = 'device_zyxwvutsrqponmlkjihgfedcba654321';

function json(status, value) {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from(JSON.stringify(value)) };
}

function proxyBackend() {
  let nextId = 1;
  let available = true;
  let failCreate = false;
  let failDelete = false;
  let failVisibility = false;
  const visibilityStatuses = [];
  const visibilityDelays = [];
  const prepareDelays = [];
  const clearDelays = [];
  const byDevice = new Map();
  const calls = [];
  const tabs = (device) => byDevice.get(device) || [];
  const save = (device, next) => byDevice.set(device, next);
  const proxyRequest = vi.fn(async ({ req, method, path, body }) => {
    calls.push({ method, path, body });
    if (!available) return null;
    const device = req.get('x-handmux-browser-device');
    if (method === 'PUT' && path === '/api/browser-tabs/profile') {
      return json(200, { ...body, warning: null });
    }
    if (method === 'POST' && path === '/api/browser-tabs/profile/clear') {
      const delay = clearDelays.shift();
      if (delay) await delay;
      const closed = tabs(device).filter((tab) => (
        body.origin === null || new URL(tab.originalUrl).origin === body.origin
      ));
      const closedIds = new Set(closed.map((tab) => tab.id));
      save(device, tabs(device).filter((tab) => !closedIds.has(tab.id)));
      return json(200, { closedTabIds: [...closedIds] });
    }
    if (method === 'GET' && path === '/api/browser-tabs') return json(200, { tabs: tabs(device) });
    if (method === 'POST' && path === '/api/browser-tabs') {
      if (failCreate) return json(503, { error: 'browser unavailable' });
      const hiddenAt = Date.now();
      save(device, tabs(device).map((tab) => tab.visible ? {
        ...tab, visible: false, hiddenAt,
        expiresAt: tab.closeAfterMinutes == null ? null : hiddenAt + tab.closeAfterMinutes * 60_000,
      } : tab));
      const tab = {
        id: `proxy-${nextId++}`, mode: 'proxy', channel: 'proxy-channel', url: `https://proxy.example/${nextId}`,
        originalUrl: body.url, title: '', closeAfterMinutes: body.closeAfterMinutes,
        visible: true, hiddenAt: null, expiresAt: null,
      };
      save(device, [...tabs(device), tab]);
      return json(201, tab);
    }
    const prepareMatch = path.match(/^\/api\/browser-tabs\/([^/]+)\/prepare-form-navigation$/);
    if (method === 'POST' && prepareMatch) {
      const delay = prepareDelays.shift();
      if (delay) await delay;
      const id = decodeURIComponent(prepareMatch[1]);
      const current = tabs(device).find((tab) => tab.id === id);
      if (!current) return json(404, { error: 'browser tab not found' });
      const updated = {
        ...current,
        originalUrl: body.url,
        url: 'https://target.preview.example/_browser-bootstrap/post-ticket',
      };
      save(device, tabs(device).map((tab) => tab.id === id ? updated : tab));
      return json(200, { url: updated.url, tab: updated });
    }
    const match = path.match(/^\/api\/browser-tabs\/([^/]+)(?:\/(navigate|visibility|metadata))?$/);
    if (!match) return json(404, { error: 'browser tab not found' });
    const id = decodeURIComponent(match[1]);
    const current = tabs(device).find((tab) => tab.id === id);
    if (!current) return json(404, { error: 'browser tab not found' });
    if (method === 'DELETE') {
      if (failDelete) return json(503, { error: 'browser unavailable' });
      save(device, tabs(device).filter((tab) => tab.id !== id));
      return { status: 204, headers: {}, body: Buffer.alloc(0) };
    }
    if (method === 'PATCH' && match[2] === 'visibility') {
      if (failVisibility) return json(503, { error: 'browser unavailable' });
      const delay = visibilityDelays.shift();
      if (delay) await delay;
      const queuedStatus = visibilityStatuses.shift();
      if (queuedStatus && queuedStatus !== 200) return json(queuedStatus, { error: 'browser unavailable' });
      const hiddenAt = body.visible ? null : Date.now();
      const updated = {
        ...current, visible: body.visible, closeAfterMinutes: body.closeAfterMinutes, hiddenAt,
        expiresAt: body.visible || body.closeAfterMinutes == null ? null : hiddenAt + body.closeAfterMinutes * 60_000,
      };
      save(device, tabs(device).map((tab) => tab.id === id ? updated : tab));
      return json(200, updated);
    }
    if (method === 'PATCH' && match[2] === 'metadata') {
      const updated = { ...current, originalUrl: body.url, title: body.title };
      save(device, tabs(device).map((tab) => tab.id === id ? updated : tab));
      return json(200, updated);
    }
    if (method === 'POST' && match[2] === 'navigate') {
      const updated = { ...current, originalUrl: body.url };
      save(device, tabs(device).map((tab) => tab.id === id ? updated : tab));
      return json(200, updated);
    }
    return json(404, { error: 'browser tab not found' });
  });
  return {
    proxyRequest, calls,
    setAvailable(value) { available = value; },
    setFailCreate(value) { failCreate = value; },
    setFailDelete(value) { failDelete = value; },
    setFailVisibility(value) { failVisibility = value; },
    queueVisibilityStatuses(...statuses) { visibilityStatuses.push(...statuses); },
    deferNextVisibility() {
      let release;
      visibilityDelays.push(new Promise((resolve) => { release = resolve; }));
      return release;
    },
    deferNextPrepare() {
      let release;
      prepareDelays.push(new Promise((resolve) => { release = resolve; }));
      return release;
    },
    deferNextClear() {
      let release;
      clearDelays.push(new Promise((resolve) => { release = resolve; }));
      return release;
    },
    drop(device, id) { save(device, tabs(device).filter((tab) => tab.id !== id)); },
    list(device) { return tabs(device); },
    setVisible(device, id, visible) {
      save(device, tabs(device).map((tab) => tab.id === id ? { ...tab, visible } : tab));
    },
  };
}

function appFor(backend, now = () => 1_000, {
  responseDelayMs = 0, coordinatorOptions = {}, onJson = () => {},
} = {}) {
  const app = express();
  app.use(express.json());
  if (responseDelayMs) app.use((_req, res, next) => {
    const jsonResponse = res.json.bind(res);
    res.json = (body) => {
      onJson(_req, body);
      setTimeout(() => jsonResponse(body), responseDelayMs);
      return res;
    };
    next();
  });
  let id = 0;
  const coordinator = createBrowserCoordinator({
    previewDomain: 'preview.example', proxyRequest: backend.proxyRequest,
    randomId: () => `direct-${++id}`, randomChannel: () => `channel-${id}`, now,
    ...coordinatorOptions,
  });
  app.use('/api/browser-tabs', coordinator);
  app.browserCoordinator = coordinator;
  return app;
}

const asDevice = (req, device = DEVICE_A) => req.set('X-Handmux-Browser-Device', device);

describe('browser main-process coordinator', () => {
  it('keeps one visible tab across stores without losing direct timer metadata or device isolation', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const direct = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://direct.example/', closeAfterMinutes: 30, mode: 'direct',
    }).expect(201);
    await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy-target.example/', closeAfterMinutes: 10, mode: 'proxy',
    }).expect(201);

    const mixed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    const hiddenDirect = mixed.body.tabs.find((tab) => tab.id === direct.body.id);
    expect(mixed.body.tabs.filter((tab) => tab.visible)).toHaveLength(1);
    expect(hiddenDirect).toMatchObject({ closeAfterMinutes: 30, hiddenAt: 1000, expiresAt: 1_801_000 });
    await asDevice(request(app).get('/api/browser-tabs'), DEVICE_B).expect(200, { tabs: [] });
  });

  it('rolls back a failed direct-to-proxy switch atomically', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const created = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://direct.example/', closeAfterMinutes: 30, mode: 'direct',
    }).expect(201);
    backend.setFailCreate(true);

    await asDevice(request(app).post(`/api/browser-tabs/${created.body.id}/navigate`))
      .send({ url: 'https://direct.example/next', mode: 'proxy' })
      .expect(503);

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs).toEqual([expect.objectContaining({
      id: created.body.id, mode: 'direct', visible: true, closeAfterMinutes: 30,
      originalUrl: 'https://direct.example/',
    })]);
  });

  it('preserves logical identity and close timing across both mode switches', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const created = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://target.example/', closeAfterMinutes: 120, mode: 'direct',
    }).expect(201);

    const proxied = await asDevice(request(app).post(`/api/browser-tabs/${created.body.id}/navigate`))
      .send({ url: created.body.originalUrl, mode: 'proxy' }).expect(200);
    expect(proxied.body).toMatchObject({ id: created.body.id, mode: 'proxy', closeAfterMinutes: 120 });
    const resynced = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(resynced.body.tabs).toEqual([expect.objectContaining({ id: created.body.id, mode: 'proxy' })]);

    const restored = await asDevice(request(app).post(`/api/browser-tabs/${created.body.id}/navigate`))
      .send({ url: created.body.originalUrl, mode: 'direct' }).expect(200);
    expect(restored.body).toMatchObject({ id: created.body.id, mode: 'direct', closeAfterMinutes: 120 });
  });

  it('rolls back a failed proxy-to-direct switch until worker deletion succeeds', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const proxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 30, mode: 'proxy',
    }).expect(201);
    backend.setFailDelete(true);

    await asDevice(request(app).post(`/api/browser-tabs/${proxy.body.id}/navigate`))
      .send({ url: 'https://direct.example/', mode: 'direct' })
      .expect(503);

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs).toEqual([expect.objectContaining({
      id: proxy.body.id, mode: 'proxy', visible: true,
    })]);
  });

  it('hides a visible proxy before committing a new direct tab', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const proxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 10, mode: 'proxy',
    }).expect(201);
    backend.setFailVisibility(true);

    await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://direct.example/', closeAfterMinutes: 10, mode: 'direct',
    }).expect(503);

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs).toEqual([expect.objectContaining({
      id: proxy.body.id, mode: 'proxy', visible: true,
    })]);
  });

  it('forgets a stale proxy after worker restart and creates a direct tab on PATCH 404', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const oldProxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://old-proxy.example/', closeAfterMinutes: 10, mode: 'proxy',
    }).expect(201);
    const proxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 10, mode: 'proxy',
    }).expect(201);
    backend.drop(DEVICE_A, oldProxy.body.id);
    backend.drop(DEVICE_A, proxy.body.id);

    const direct = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://direct.example/', closeAfterMinutes: 30, mode: 'direct',
    }).expect(201);

    const beforeNavigate = backend.calls.length;
    await asDevice(request(app).post(`/api/browser-tabs/${oldProxy.body.id}/navigate`))
      .send({ url: oldProxy.body.originalUrl, mode: 'direct' })
      .expect(404);
    expect(backend.calls.slice(beforeNavigate)).toContainEqual(expect.objectContaining({
      method: 'GET', path: '/api/browser-tabs',
    }));
    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs).toEqual([expect.objectContaining({ id: direct.body.id, visible: true })]);
  });

  it('does not swallow non-404 client errors while hiding a proxy for direct create', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const proxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 10, mode: 'proxy',
    }).expect(201);
    backend.queueVisibilityStatuses(409);

    await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://direct.example/', closeAfterMinutes: 30, mode: 'direct',
    }).expect(409);

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs).toEqual([expect.objectContaining({ id: proxy.body.id, visible: true })]);
    await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://retry.example/', closeAfterMinutes: 30, mode: 'direct',
    }).expect(201);
  });

  it('does not mark a direct tab visible when hiding the proxy fails', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const direct = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://direct.example/', closeAfterMinutes: 10, mode: 'direct',
    }).expect(201);
    await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 10, mode: 'proxy',
    }).expect(201);
    backend.setFailVisibility(true);

    await asDevice(request(app).patch(`/api/browser-tabs/${direct.body.id}/visibility`))
      .send({ visible: true, closeAfterMinutes: 10 })
      .expect(503);

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs.filter((tab) => tab.visible)).toEqual([
      expect.objectContaining({ mode: 'proxy' }),
    ]);
  });

  it('forgets a stale proxy after worker restart and restores direct visibility on PATCH 404', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const direct = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://direct.example/', closeAfterMinutes: 30, mode: 'direct',
    }).expect(201);
    const proxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 10, mode: 'proxy',
    }).expect(201);
    backend.drop(DEVICE_A, proxy.body.id);

    await asDevice(request(app).patch(`/api/browser-tabs/${direct.body.id}/visibility`))
      .send({ visible: true, closeAfterMinutes: 30 })
      .expect(200);

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs).toEqual([expect.objectContaining({
      id: direct.body.id, visible: true, closeAfterMinutes: 30, hiddenAt: null, expiresAt: null,
    })]);
  });

  it('does not synthesize a hidden proxy when GET reconciliation cannot hide it', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const proxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 10, mode: 'proxy',
    }).expect(201);
    const direct = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://direct.example/', closeAfterMinutes: 10, mode: 'direct',
    }).expect(201);
    backend.setVisible(DEVICE_A, proxy.body.id, true);
    backend.setFailVisibility(true);

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs.filter((tab) => tab.visible)).toEqual([
      expect.objectContaining({ id: proxy.body.id, mode: 'proxy' }),
    ]);
    expect(listed.body.tabs).toContainEqual(expect.objectContaining({
      id: direct.body.id, mode: 'direct', visible: false,
    }));
  });

  it('drops unconfirmed proxy cache after worker failure but keeps direct tabs', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const direct = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://direct.example/', closeAfterMinutes: 10, mode: 'direct',
    }).expect(201);
    await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 10, mode: 'proxy',
    }).expect(201);
    backend.setAvailable(false);

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs).toEqual([expect.objectContaining({ id: direct.body.id, mode: 'direct' })]);
  });

  it('does not let another device turn a known proxy tab id into its own direct tab', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const proxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://private.example/', closeAfterMinutes: 10, mode: 'proxy',
    }).expect(201);

    await asDevice(request(app).post(`/api/browser-tabs/${proxy.body.id}/navigate`), DEVICE_B)
      .send({ url: proxy.body.originalUrl, mode: 'direct' })
      .expect(404);
    await asDevice(request(app).get('/api/browser-tabs'), DEVICE_B).expect(200, { tabs: [] });
  });

  it('removes a direct tab when its create response is aborted', async () => {
    const backend = proxyBackend();
    const app = appFor(backend, () => 1_000, { responseDelayMs: 100 });

    await expect(asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://direct.example/', closeAfterMinutes: 10, mode: 'direct',
    }).timeout({ response: 20 })).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 120));

    await asDevice(request(app).get('/api/browser-tabs')).expect(200, { tabs: [] });
  });

  it('restores the displaced direct tab and its close timing when direct create is aborted', async () => {
    const backend = proxyBackend();
    const app = appFor(backend, () => 1_000, { responseDelayMs: 100 });
    const original = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://original.example/', closeAfterMinutes: 30, mode: 'direct',
    }).expect(201);

    await expect(asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://aborted.example/', closeAfterMinutes: 10, mode: 'direct',
    }).timeout({ response: 20 })).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 140));

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs).toEqual([expect.objectContaining({
      id: original.body.id, visible: true, closeAfterMinutes: 30, hiddenAt: null, expiresAt: null,
    })]);
  });

  it('restores the displaced proxy tab when direct create is aborted', async () => {
    const backend = proxyBackend();
    const app = appFor(backend, () => 1_000, { responseDelayMs: 100 });
    const proxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 30, mode: 'proxy',
    }).expect(201);

    await expect(asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://aborted.example/', closeAfterMinutes: 10, mode: 'direct',
    }).timeout({ response: 20 })).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 140));

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs).toEqual([expect.objectContaining({
      id: proxy.body.id, mode: 'proxy', visible: true, closeAfterMinutes: 30,
      hiddenAt: null, expiresAt: null,
    })]);
  });

  it('keeps worker truth when restoring a displaced proxy after abort fails', async () => {
    const backend = proxyBackend();
    const app = appFor(backend, () => 1_000, { responseDelayMs: 100 });
    const proxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 30, mode: 'proxy',
    }).expect(201);
    backend.queueVisibilityStatuses(200, 503);

    await expect(asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://aborted.example/', closeAfterMinutes: 10, mode: 'direct',
    }).timeout({ response: 20 })).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 140));

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs).toEqual([expect.objectContaining({
      id: proxy.body.id, mode: 'proxy', visible: false, closeAfterMinutes: 30,
    })]);
  });

  it('rolls back after aborting while proxy hide is still in flight', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const proxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 30, mode: 'proxy',
    }).expect(201);
    const releaseHide = backend.deferNextVisibility();

    const pending = asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://aborted.example/', closeAfterMinutes: 10, mode: 'direct',
    });
    const outcome = pending.then(() => null, (error) => error);
    await vi.waitFor(() => expect(backend.calls).toContainEqual(expect.objectContaining({
      method: 'PATCH', body: expect.objectContaining({ visible: false }),
    })));
    pending.abort();
    expect(await outcome).toBeInstanceOf(Error);
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseHide();
    await new Promise((resolve) => setTimeout(resolve, 80));

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs).toEqual([expect.objectContaining({
      id: proxy.body.id, mode: 'proxy', visible: true, closeAfterMinutes: 30,
    })]);
  });

  it('does not let an aborted direct rollback override a newer successful direct create', async () => {
    const backend = proxyBackend();
    const committed = new Map();
    const signal = (url) => new Promise((resolve) => committed.set(url, resolve));
    const aCommitted = signal('https://a.example/');
    const bCommitted = signal('https://b.example/');
    const app = appFor(backend, () => 1_000, {
      responseDelayMs: 100,
      onJson: (_req, body) => committed.get(body?.originalUrl)?.(),
    });
    const original = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://original.example/', closeAfterMinutes: 30, mode: 'direct',
    }).expect(201);
    const pendingA = asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://a.example/', closeAfterMinutes: 10, mode: 'direct',
    });
    const outcomeA = pendingA.then(() => null, (error) => error);
    await aCommitted;
    const pendingB = asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://b.example/', closeAfterMinutes: 60, mode: 'direct',
    });
    const outcomeB = pendingB.then((response) => response);
    await Promise.race([bCommitted, new Promise((resolve) => setTimeout(resolve, 30))]);

    pendingA.abort();
    expect(await outcomeA).toBeInstanceOf(Error);
    const createdB = await outcomeB;
    expect(createdB.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs.filter((tab) => tab.visible)).toEqual([
      expect.objectContaining({ id: createdB.body.id, originalUrl: 'https://b.example/' }),
    ]);
    expect(listed.body.tabs).toContainEqual(expect.objectContaining({
      id: original.body.id, visible: false, closeAfterMinutes: 30,
      hiddenAt: 1000, expiresAt: 1_801_000,
    }));
  });

  it('does not let an aborted proxy rollback override a newer successful direct create', async () => {
    const backend = proxyBackend();
    const committed = new Map();
    const signal = (url) => new Promise((resolve) => committed.set(url, resolve));
    const aCommitted = signal('https://a.example/');
    const bCommitted = signal('https://b.example/');
    const app = appFor(backend, () => 1_000, {
      responseDelayMs: 100,
      onJson: (_req, body) => committed.get(body?.originalUrl)?.(),
    });
    const original = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 30, mode: 'proxy',
    }).expect(201);
    const pendingA = asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://a.example/', closeAfterMinutes: 10, mode: 'direct',
    });
    const outcomeA = pendingA.then(() => null, (error) => error);
    await aCommitted;
    const pendingB = asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://b.example/', closeAfterMinutes: 60, mode: 'direct',
    });
    const outcomeB = pendingB.then((response) => response);
    await Promise.race([bCommitted, new Promise((resolve) => setTimeout(resolve, 30))]);
    const releaseRestore = backend.deferNextVisibility();

    pendingA.abort();
    expect(await outcomeA).toBeInstanceOf(Error);
    await vi.waitFor(() => expect(backend.calls).toContainEqual(expect.objectContaining({
      method: 'PATCH', body: expect.objectContaining({ visible: true }),
    })));
    releaseRestore();
    const createdB = await outcomeB;
    expect(createdB.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(backend.list(DEVICE_A).filter((tab) => tab.visible)).toEqual([]);

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs.filter((tab) => tab.visible)).toEqual([
      expect.objectContaining({ id: createdB.body.id, originalUrl: 'https://b.example/' }),
    ]);
    expect(listed.body.tabs).toContainEqual(expect.objectContaining({
      id: original.body.id, mode: 'proxy', visible: false, closeAfterMinutes: 30,
    }));
  });

  it('keeps different devices parallel while one device waits for proxy visibility', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 30, mode: 'proxy',
    }).expect(201);
    const releaseHide = backend.deferNextVisibility();
    const pendingA = asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://a.example/', closeAfterMinutes: 10, mode: 'direct',
    });
    const outcomeA = pendingA.then((response) => response);
    await vi.waitFor(() => expect(backend.calls).toContainEqual(expect.objectContaining({
      method: 'PATCH', body: expect.objectContaining({ visible: false }),
    })));

    await asDevice(request(app).post('/api/browser-tabs'), DEVICE_B).send({
      url: 'https://b.example/', closeAfterMinutes: 60, mode: 'direct',
    }).expect(201);

    releaseHide();
    expect((await outcomeA).status).toBe(201);
    const [listedA, listedB] = await Promise.all([
      asDevice(request(app).get('/api/browser-tabs')).expect(200),
      asDevice(request(app).get('/api/browser-tabs'), DEVICE_B).expect(200),
    ]);
    expect(listedA.body.tabs.filter((tab) => tab.visible)).toHaveLength(1);
    expect(listedB.body.tabs.filter((tab) => tab.visible)).toHaveLength(1);
  });

  it('serializes profile clear with later same-device opens while another device remains parallel', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const direct = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://direct.example/', closeAfterMinutes: 30, mode: 'direct',
    }).expect(201);
    const oldProxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://app.example/old', closeAfterMinutes: 30, mode: 'proxy',
    }).expect(201);
    const releaseClear = backend.deferNextClear();

    const pendingClear = asDevice(request(app).post('/api/browser-tabs/profile/clear'))
      .send({ origin: 'https://app.example' });
    const clearOutcome = pendingClear.then((response) => response);
    await vi.waitFor(() => expect(backend.calls).toContainEqual(expect.objectContaining({
      method: 'POST', path: '/api/browser-tabs/profile/clear',
    })));

    const createsBefore = backend.calls.filter((call) => (
      call.method === 'POST' && call.path === '/api/browser-tabs'
    )).length;
    const pendingOpen = asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://app.example/new', closeAfterMinutes: 30, mode: 'proxy',
    });
    const openOutcome = pendingOpen.then((response) => response);

    await asDevice(request(app).put('/api/browser-tabs/profile'), DEVICE_B)
      .send({ persist: true, retentionDays: 7 })
      .expect(200, { persist: true, retentionDays: 7, warning: null });
    expect(backend.calls.filter((call) => (
      call.method === 'POST' && call.path === '/api/browser-tabs'
    ))).toHaveLength(createsBefore);

    releaseClear();
    expect((await clearOutcome).body.closedTabIds).toEqual([oldProxy.body.id]);
    expect((await openOutcome).status).toBe(201);

    const listed = await asDevice(request(app).get('/api/browser-tabs')).expect(200);
    expect(listed.body.tabs).toContainEqual(expect.objectContaining({ id: direct.body.id, mode: 'direct' }));
    expect(listed.body.tabs).not.toContainEqual(expect.objectContaining({ id: oldProxy.body.id }));
    expect(listed.body.tabs).toContainEqual(expect.objectContaining({
      originalUrl: 'https://app.example/new', mode: 'proxy',
    }));
  });

  it('forwards prepared form navigation with logical ids and serializes later device mutations', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const proxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://a.example/', closeAfterMinutes: 30, mode: 'proxy',
    }).expect(201);
    const releasePrepare = backend.deferNextPrepare();

    const pendingPrepare = asDevice(request(app)
      .post(`/api/browser-tabs/${proxy.body.id}/prepare-form-navigation`))
      .send({ url: 'https://b.example/login' });
    const prepareOutcome = pendingPrepare.then((response) => response);
    await vi.waitFor(() => expect(backend.calls).toContainEqual(expect.objectContaining({
      method: 'POST',
      path: expect.stringMatching(/\/prepare-form-navigation$/),
    })));

    const pendingVisibility = asDevice(request(app)
      .patch(`/api/browser-tabs/${proxy.body.id}/visibility`))
      .send({ visible: false, closeAfterMinutes: 30 });
    const visibilityOutcome = pendingVisibility.then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);

    releasePrepare();
    const prepared = await prepareOutcome;
    expect(prepared.status).toBe(200);
    expect(prepared.body.tab).toMatchObject({
      id: proxy.body.id,
      originalUrl: 'https://b.example/login',
    });
    expect((await visibilityOutcome).status).toBe(200);
  });

  it('forwards page-driven metadata and keeps the logical tab current', async () => {
    const backend = proxyBackend();
    const app = appFor(backend);
    const proxy = await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://a.example/', closeAfterMinutes: 30, mode: 'proxy',
    }).expect(201);

    const updated = await asDevice(request(app)
      .patch(`/api/browser-tabs/${proxy.body.id}/metadata`))
      .send({ url: 'https://b.example/account', title: 'Account' })
      .expect(200);

    expect(updated.body).toMatchObject({
      id: proxy.body.id,
      originalUrl: 'https://b.example/account',
      title: 'Account',
    });
    expect(backend.calls).toContainEqual(expect.objectContaining({
      method: 'PATCH',
      path: expect.stringMatching(/\/metadata$/),
      body: { url: 'https://b.example/account', title: 'Account' },
    }));
  });

  it('clears direct expiry timers when the coordinator closes', async () => {
    const backend = proxyBackend();
    const timer = { id: 'direct-expiry' };
    const clearTimer = vi.fn();
    const app = appFor(backend, () => 1_000, {
      coordinatorOptions: { setTimer: vi.fn(() => timer), clearTimer },
    });
    await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://direct.example/', closeAfterMinutes: 10, mode: 'direct',
    }).expect(201);
    await asDevice(request(app).post('/api/browser-tabs')).send({
      url: 'https://proxy.example/', closeAfterMinutes: 10, mode: 'proxy',
    }).expect(201);

    app.browserCoordinator.close();

    expect(clearTimer).toHaveBeenCalledWith(timer);
  });
});
