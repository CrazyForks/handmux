import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { browserRoutes } from '../src/browser/routes.js';

function appFor(browser) {
  const app = express();
  app.use(express.json());
  app.use(browserRoutes({ browser }));
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
    expect(browser.navigate).toHaveBeenCalledWith('tab-a', 'https://next.example/', DEVICE);
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
