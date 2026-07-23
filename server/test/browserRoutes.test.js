import express from 'express';
import http from 'node:http';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { browserRoutes } from '../src/browser/routes.js';

function appFor(browser, previewDomain = null, browserBootstrap = null) {
  const app = express();
  app.use(express.json());
  app.use(browserRoutes({ browser, previewDomain, browserBootstrap }));
  return app;
}
const DEVICE = 'device_abcdefghijklmnopqrstuvwxyz123456';
const asDevice = (req, device = DEVICE) => req.set('X-Handmux-Browser-Device', device);

function browserFake() {
  return {
    create: vi.fn(({ url }) => ({ id: 'tab-a', originalUrl: url, url: 'https://handmux.example/_browser-tab-a/https://target/' })),
    list: vi.fn(() => [{ id: 'tab-a', originalUrl: 'https://target/' }]),
    get: vi.fn(() => ({ id: 'tab-a' })),
    setVisible: vi.fn(() => ({ id: 'tab-a', visible: false, expiresAt: 600_000 })),
    navigate: vi.fn((_id, url) => ({ id: 'tab-a', originalUrl: new URL(url).toString() })),
    closeTab: vi.fn(() => ({ id: 'tab-a' })),
    configureDeviceProfile: vi.fn(async (_deviceId, prefs) => prefs),
    clearDeviceProfile: vi.fn(async () => ({ closedTabIds: ['tab-a'] })),
  };
}

describe('browser routes', () => {
  it('configures only the requesting device profile', async () => {
    const browser = browserFake();

    await asDevice(request(appFor(browser)).put('/browser-tabs/profile'))
      .send({ persist: true, retentionDays: 7 })
      .expect(200, { persist: true, retentionDays: 7 });

    expect(browser.configureDeviceProfile).toHaveBeenCalledWith(
      DEVICE,
      { persist: true, retentionDays: 7 },
    );
  });

  it.each([
    [{ persist: 'yes', retentionDays: 7 }],
    [{ persist: true, retentionDays: 14 }],
    [{ persist: true }],
  ])('rejects invalid profile preferences %#', async (body) => {
    const browser = browserFake();

    await asDevice(request(appFor(browser)).put('/browser-tabs/profile'))
      .send(body)
      .expect(400, { error: 'bad browser profile preferences' });

    expect(browser.configureDeviceProfile).not.toHaveBeenCalled();
  });

  it('clears one normalized HTTP(S) Origin and returns tabs actually closed', async () => {
    const browser = browserFake();

    await asDevice(request(appFor(browser)).post('/browser-tabs/profile/clear'))
      .send({ origin: 'https://app.internal.example/path' })
      .expect(200, { closedTabIds: ['tab-a'] });

    expect(browser.clearDeviceProfile).toHaveBeenCalledWith(
      DEVICE,
      { origin: 'https://app.internal.example' },
    );
  });

  it('uses null exclusively for all-profile cleanup', async () => {
    const browser = browserFake();

    await asDevice(request(appFor(browser)).post('/browser-tabs/profile/clear'))
      .send({ origin: null })
      .expect(200);
    await asDevice(request(appFor(browser)).post('/browser-tabs/profile/clear'))
      .send({})
      .expect(400, { error: 'bad browser profile clear request' });
    await asDevice(request(appFor(browser)).post('/browser-tabs/profile/clear'))
      .send({ origin: 'ftp://app.internal.example' })
      .expect(400, { error: 'bad browser profile clear request' });

    expect(browser.clearDeviceProfile).toHaveBeenCalledTimes(1);
    expect(browser.clearDeviceProfile).toHaveBeenCalledWith(DEVICE, { origin: null });
  });

  it('creates a direct tab without using a fallback proxy origin', async () => {
    const browser = browserFake();
    const res = await asDevice(request(appFor(browser)).post('/browser-tabs'))
      .set('Host', 'internal.example:30443')
      .set('X-Forwarded-Proto', 'https')
      .send({ url: 'https://target.example/path', closeAfterMinutes: 10, mode: 'direct' });

    expect(res.status).toBe(201);
    expect(browser.create).toHaveBeenCalledWith({
      url: 'https://target.example/path', origin: 'https://internal.example:30443', closeAfterMinutes: 10, deviceId: DEVICE, mode: 'direct',
    });
    expect(res.body.id).toBe('tab-a');
  });

  it.each(['direct', 'proxy'])('accepts mode=%s when creating a tab', async (mode) => {
    const browser = browserFake();

    const configured = mode === 'proxy'
      ? appFor(browser, 'preview.example', { issue: vi.fn(({ url }) => url) })
      : appFor(browser);
    await asDevice(request(configured).post('/browser-tabs'))
      .send({ url: 'https://target.example/', closeAfterMinutes: 10, mode })
      .expect(201);

    expect(browser.create).toHaveBeenCalledWith(expect.objectContaining({ mode }));
  });

  it.each([
    ['explicit proxy', { mode: 'proxy' }],
    ['legacy missing mode', {}],
  ])('rejects %s create when previewDomain is not configured', async (_label, extra) => {
    const browser = browserFake();

    const res = await asDevice(request(appFor(browser)).post('/browser-tabs'))
      .send({ url: 'https://target.example/', closeAfterMinutes: 10, ...extra });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('browser proxy unavailable');
    expect(browser.create).not.toHaveBeenCalled();
  });

  it('rejects an unsupported create mode', async () => {
    const browser = browserFake();

    const res = await asDevice(request(appFor(browser)).post('/browser-tabs'))
      .send({ url: 'https://target.example/', closeAfterMinutes: 10, mode: 'reader' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported browser mode');
    expect(browser.create).not.toHaveBeenCalled();
  });

  it('closes a tab created after disconnect and restores the exact tab displaced at commit time', async () => {
    let releaseCreate;
    const browser = browserFake();
    browser.list.mockReturnValue([{ id: 'previous', visible: false, closeAfterMinutes: 30 }, { id: 'newer', visible: false, closeAfterMinutes: 10 }]);
    browser.create.mockReturnValue(new Promise((resolve) => { releaseCreate = resolve; }));
    const server = appFor(browser).listen(0);
    try {
      await new Promise((resolve) => server.once('listening', resolve));
      const body = JSON.stringify({ url: 'https://target.example/path', closeAfterMinutes: 10, mode: 'direct' });
      const pending = http.request({
        port: server.address().port,
        path: '/browser-tabs',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Handmux-Browser-Device': DEVICE,
        },
      });
      pending.on('error', () => {});
      pending.end(body);
      await vi.waitFor(() => expect(browser.create).toHaveBeenCalledOnce());

      pending.destroy();
      await new Promise((resolve) => setTimeout(resolve, 20));
      releaseCreate({
        id: 'tab-a', originalUrl: 'https://target.example/path', url: 'https://handmux.example/proxy',
        _displacedTabs: [{ id: 'newer', closeAfterMinutes: 10 }],
      });
      await vi.waitFor(() => expect(browser.closeTab).toHaveBeenCalledWith('tab-a', DEVICE));
      expect(browser.setVisible).toHaveBeenCalledWith('newer', true, 10, DEVICE);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('ignores a forwarded host when creating the public session origin', async () => {
    const browser = browserFake();
    await asDevice(request(appFor(browser)).post('/browser-tabs'))
      .set('Host', 'actual.example')
      .set('X-Forwarded-Host', 'spoofed.example')
      .set('X-Forwarded-Proto', 'https')
      .send({ url: 'https://target.example/', closeAfterMinutes: 10, mode: 'direct' })
      .expect(201);

    expect(browser.create).toHaveBeenCalledWith(expect.objectContaining({ origin: 'https://actual.example' }));
  });

  it('uses a wildcard previewDomain subdomain as the browser public origin', async () => {
    const browser = browserFake();
    browser.create.mockImplementation(({ url, origin }) => ({
      id: 'tab-a', originalUrl: url, url: `${origin}/_browser-tab-a/https://target/`,
    }));
    const browserBootstrap = { issue: vi.fn(({ url }) => url) };
    const res = await asDevice(request(appFor(
      browser,
      'handmux.example.com:30443',
      browserBootstrap,
    )).post('/browser-tabs'))
      .set('Host', 'example.com')
      .set('X-Forwarded-Proto', 'https')
      .send({ url: 'https://target.example/', closeAfterMinutes: 10 })
      .expect(201);

    const origin = new URL(browser.create.mock.calls[0][0].origin);
    expect(origin.hostname).toMatch(/^b-[0-9a-z]{13}\.handmux\.example\.com$/);
    expect(origin.port).toBe('30443');
    expect(browserBootstrap.issue).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: DEVICE,
      origin: origin.origin,
    }));
    expect(res.body.url).toBe(`${origin.origin}/_browser-tab-a/https://target/`);
    expect(res.headers['set-cookie'][0]).not.toContain('Domain=');
    expect(res.headers['set-cookie'][0]).toContain('Secure');
  });

  it('keeps a direct tab URL unchanged when previewDomain is configured', async () => {
    const browser = browserFake();
    browser.create.mockImplementation(({ url, mode }) => ({
      id: 'tab-a', mode, originalUrl: url, url,
    }));
    const browserBootstrap = { issue: vi.fn() };

    const res = await asDevice(request(appFor(browser, 'preview.example', browserBootstrap))
      .post('/browser-tabs'))
      .send({ url: 'https://target.example/', closeAfterMinutes: 10, mode: 'direct' })
      .expect(201);

    expect(res.body.url).toBe('https://target.example/');
    expect(browserBootstrap.issue).not.toHaveBeenCalled();
  });

  it('rolls back a created tab when bootstrap serialization fails', async () => {
    const browser = browserFake();
    browser.create.mockReturnValue({
      id: 'tab-a', originalUrl: 'https://target.example/',
      url: 'https://browser-target.preview.example/_browser-tab-a/https://target.example/',
      _displacedTabs: [{ id: 'previous', closeAfterMinutes: 30 }],
    });
    browser.list.mockReturnValue([{ id: 'previous', visible: false, closeAfterMinutes: 30 }]);
    const browserBootstrap = { issue: vi.fn(() => { throw new Error('ticket failed'); }) };

    await asDevice(request(appFor(browser, 'preview.example', browserBootstrap)).post('/browser-tabs'))
      .send({ url: 'https://target.example/', closeAfterMinutes: 10 })
      .expect(500);

    expect(browser.closeTab).toHaveBeenCalledWith('tab-a', DEVICE);
    expect(browser.setVisible).toHaveBeenCalledWith('previous', true, 30, DEVICE);
  });

  it('maps the same target origin to one subdomain and treats another port as a different origin', async () => {
    const browser = browserFake();
    browser.create.mockImplementation(({ url, origin }) => ({
      id: `tab-${browser.create.mock.calls.length}`,
      originalUrl: url,
      url: `${origin}/_browser-session/https://target/`,
    }));
    const browserBootstrap = { issue: vi.fn(({ url }) => url) };
    const app = appFor(browser, 'handmux.example.com:30443', browserBootstrap);

    await asDevice(request(app).post('/browser-tabs')).send({ url: 'https://target.example/a', closeAfterMinutes: 10 }).expect(201);
    await asDevice(request(app).post('/browser-tabs')).send({ url: 'https://target.example/b', closeAfterMinutes: 10 }).expect(201);
    await asDevice(request(app).post('/browser-tabs')).send({ url: 'https://target.example:8443/a', closeAfterMinutes: 10 }).expect(201);

    const [firstOrigin, secondOrigin, otherPortOrigin] = browser.create.mock.calls
      .map(([options]) => new URL(options.origin));
    expect(firstOrigin.hostname).toMatch(/^b-[0-9a-z]{13}\.handmux\.example\.com$/);
    expect(secondOrigin.hostname).toBe(firstOrigin.hostname);
    expect(otherPortOrigin.hostname).not.toBe(firstOrigin.hostname);
  });

  it.each([10, 30, 60, 120, null])('accepts closeAfterMinutes=%s', async (closeAfterMinutes) => {
    const browser = browserFake();
    const res = await asDevice(request(appFor(browser)).post('/browser-tabs')).send({ url: 'https://target.example/', closeAfterMinutes, mode: 'direct' });
    expect(res.status).toBe(201);
  });

  it.each([undefined, 0, 5, 15, 180, '10'])('rejects unsupported closeAfterMinutes=%s', async (closeAfterMinutes) => {
    const browser = browserFake();
    const body = { url: 'https://target.example/' };
    if (closeAfterMinutes !== undefined) body.closeAfterMinutes = closeAfterMinutes;
    const res = await asDevice(request(appFor(browser)).post('/browser-tabs')).send(body);
    expect(res.status).toBe(400);
    expect(browser.create).not.toHaveBeenCalled();
  });

  it.each(['ftp://target.example/', 'javascript:alert(1)', 'not a URL'])('rejects unsupported target %s', async (url) => {
    const browser = browserFake();
    const res = await asDevice(request(appFor(browser)).post('/browser-tabs')).send({ url, closeAfterMinutes: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/http/i);
  });

  it('lists tabs', async () => {
    const browser = browserFake();
    const res = await asDevice(request(appFor(browser)).get('/browser-tabs'));
    expect(res.status).toBe(200);
    expect(browser.list).toHaveBeenCalledWith(DEVICE);
    expect(res.body.tabs).toEqual([{ id: 'tab-a', originalUrl: 'https://target/' }]);
  });

  it('reissues preview-origin bootstrap URLs when listing existing tabs', async () => {
    const browser = browserFake();
    browser.list.mockReturnValue([{ id: 'tab-a', url: 'https://browser-existing.handmux.example.com:30443/_browser-tab-a/https://target/' }]);
    const browserBootstrap = { issue: vi.fn(() => 'https://browser-existing.handmux.example.com:30443/_browser-bootstrap/recovery') };

    const res = await asDevice(request(appFor(browser, 'handmux.example.com:30443', browserBootstrap)).get('/browser-tabs'))
      .expect(200);

    expect(res.body.tabs[0].url).toBe('https://browser-existing.handmux.example.com:30443/_browser-bootstrap/recovery');
    expect(browserBootstrap.issue).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'https://browser-existing.handmux.example.com:30443',
      deviceId: DEVICE,
    }));
  });

  it('updates one tab visibility and its independent close duration', async () => {
    const browser = browserFake();
    const res = await asDevice(request(appFor(browser)).patch('/browser-tabs/tab-a/visibility')).send({ visible: false, closeAfterMinutes: 30 });
    expect(res.status).toBe(200);
    expect(browser.setVisible).toHaveBeenCalledWith('tab-a', false, 30, DEVICE);
  });

  it('navigates an existing tab', async () => {
    const browser = browserFake();
    const configured = appFor(browser, 'preview.example', { issue: vi.fn(({ url }) => url) });
    const res = await asDevice(request(configured).post('/browser-tabs/tab-a/navigate')).send({ url: 'https://next.example/' });
    expect(res.status).toBe(200);
    expect(browser.navigate).toHaveBeenCalledWith('tab-a', 'https://next.example/', DEVICE, expect.any(String), 'proxy');
  });

  it.each(['direct', 'proxy'])('accepts mode=%s when navigating a tab', async (mode) => {
    const browser = browserFake();

    const configured = mode === 'proxy'
      ? appFor(browser, 'preview.example', { issue: vi.fn(({ url }) => url) })
      : appFor(browser);
    await asDevice(request(configured).post('/browser-tabs/tab-a/navigate'))
      .send({ url: 'https://next.example/', mode })
      .expect(200);

    expect(browser.navigate).toHaveBeenCalledWith('tab-a', 'https://next.example/', DEVICE, expect.any(String), mode);
  });

  it.each([
    ['explicit proxy', { mode: 'proxy' }],
    ['legacy missing mode', {}],
  ])('rejects %s navigation when previewDomain is not configured', async (_label, extra) => {
    const browser = browserFake();

    const res = await asDevice(request(appFor(browser)).post('/browser-tabs/tab-a/navigate'))
      .send({ url: 'https://next.example/', ...extra });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('browser proxy unavailable');
    expect(browser.navigate).not.toHaveBeenCalled();
  });

  it('rejects an unsupported navigation mode', async () => {
    const browser = browserFake();

    const res = await asDevice(request(appFor(browser)).post('/browser-tabs/tab-a/navigate'))
      .send({ url: 'https://next.example/', mode: 'reader' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported browser mode');
    expect(browser.navigate).not.toHaveBeenCalled();
  });

  it('reissues a preview-origin bootstrap URL after navigation', async () => {
    const browser = browserFake();
    browser.navigate.mockReturnValue({
      id: 'tab-a',
      originalUrl: 'https://next.example/',
      url: 'https://browser-existing.handmux.example.com:30443/_browser-tab-a/https://next.example/',
    });
    const browserBootstrap = { issue: vi.fn(() => 'https://browser-existing.handmux.example.com:30443/_browser-bootstrap/navigate') };

    const res = await asDevice(request(appFor(browser, 'handmux.example.com:30443', browserBootstrap))
      .post('/browser-tabs/tab-a/navigate')).send({ url: 'https://next.example/' }).expect(200);

    expect(res.body.url).toBe('https://browser-existing.handmux.example.com:30443/_browser-bootstrap/navigate');
  });

  it('returns 404 when updating a missing tab', async () => {
    const browser = browserFake();
    browser.setVisible.mockReturnValue(null);
    const res = await asDevice(request(appFor(browser)).patch('/browser-tabs/missing/visibility')).send({ visible: false, closeAfterMinutes: 10 });
    expect(res.status).toBe(404);
  });

  it('closes one tab', async () => {
    const browser = browserFake();
    const res = await asDevice(request(appFor(browser)).delete('/browser-tabs/tab-a'));
    expect(res.status).toBe(204);
    expect(browser.closeTab).toHaveBeenCalledWith('tab-a', DEVICE);
  });

  it('requires a strong per-device browser id and sets its private cookie', async () => {
    const browser = browserFake();
    await request(appFor(browser)).get('/browser-tabs').expect(400);
    await request(appFor(browser)).get('/browser-tabs').set('X-Handmux-Browser-Device', 'short').expect(400);
    const res = await asDevice(request(appFor(browser)).get('/browser-tabs')).expect(200);
    expect(res.headers['set-cookie'][0]).toContain(`tw_browser_device=${DEVICE}`);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(res.headers['set-cookie'][0]).toMatch(/SameSite=Strict/);
  });
});
