import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { browserRoutes } from '../src/browser/routes.js';

function appFor(browser, previewDomain = null, browserBootstrap = null, browserHostForTarget = undefined) {
  const app = express();
  app.use(express.json());
  app.use(browserRoutes({ browser, previewDomain, browserBootstrap, browserHostForTarget }));
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
  };
}

describe('browser routes', () => {
  it('creates a tab using the current forwarded Handmux origin', async () => {
    const browser = browserFake();
    const res = await asDevice(request(appFor(browser)).post('/browser-tabs'))
      .set('Host', 'internal.example:30443')
      .set('X-Forwarded-Proto', 'https')
      .send({ url: 'https://target.example/path', closeAfterMinutes: 10 });

    expect(res.status).toBe(201);
    expect(browser.create).toHaveBeenCalledWith({
      url: 'https://target.example/path', origin: 'https://internal.example:30443', closeAfterMinutes: 10, deviceId: DEVICE,
    });
    expect(res.body.id).toBe('tab-a');
  });

  it('ignores a forwarded host when creating the public session origin', async () => {
    const browser = browserFake();
    await asDevice(request(appFor(browser)).post('/browser-tabs'))
      .set('Host', 'actual.example')
      .set('X-Forwarded-Host', 'spoofed.example')
      .set('X-Forwarded-Proto', 'https')
      .send({ url: 'https://target.example/', closeAfterMinutes: 10 })
      .expect(201);

    expect(browser.create).toHaveBeenCalledWith(expect.objectContaining({ origin: 'https://actual.example' }));
  });

  it('uses a wildcard previewDomain subdomain as the browser public origin', async () => {
    const browser = browserFake();
    browser.create.mockImplementation(({ url, origin }) => ({
      id: 'tab-a', originalUrl: url, url: `${origin}/_browser-tab-a/https://target/`,
    }));
    const browserBootstrap = { issue: vi.fn(() => 'https://browser-idata.handmux.example.com:30443/_browser-bootstrap/ticket') };
    const res = await asDevice(request(appFor(
      browser,
      'handmux.example.com:30443',
      browserBootstrap,
      () => 'idata',
    )).post('/browser-tabs'))
      .set('Host', 'example.com')
      .set('X-Forwarded-Proto', 'https')
      .send({ url: 'https://target.example/', closeAfterMinutes: 10 })
      .expect(201);

    expect(browser.create).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'https://browser-idata.handmux.example.com:30443',
    }));
    expect(browserBootstrap.issue).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: DEVICE,
      origin: 'https://browser-idata.handmux.example.com:30443',
    }));
    expect(res.body.url).toBe('https://browser-idata.handmux.example.com:30443/_browser-bootstrap/ticket');
    expect(res.headers['set-cookie'][0]).not.toContain('Domain=');
    expect(res.headers['set-cookie'][0]).toContain('Secure');
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

    const origins = browser.create.mock.calls.map(([options]) => options.origin);
    expect(origins[0]).toBe(origins[1]);
    expect(origins[2]).not.toBe(origins[0]);
  });

  it.each([10, 30, 60, 120, null])('accepts closeAfterMinutes=%s', async (closeAfterMinutes) => {
    const browser = browserFake();
    const res = await asDevice(request(appFor(browser)).post('/browser-tabs')).send({ url: 'https://target.example/', closeAfterMinutes });
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
    const res = await asDevice(request(appFor(browser)).post('/browser-tabs/tab-a/navigate')).send({ url: 'https://next.example/' });
    expect(res.status).toBe(200);
    expect(browser.navigate).toHaveBeenCalledWith('tab-a', 'https://next.example/', DEVICE, expect.any(String));
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
