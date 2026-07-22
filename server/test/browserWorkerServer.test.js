import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserWorkerServer } from '../src/browser/workerServer.js';

const workers = [];
const DEVICE = 'device_abcdefghijklmnopqrstuvwxyz123456';

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.close()));
});

function browserFake() {
  return {
    create: vi.fn(({ url, origin }) => ({
      id: 'tab-a', originalUrl: url, url: `${origin}/_browser-tab-a/https://target/`,
    })),
    list: vi.fn(() => []),
    close: vi.fn(async () => {}),
  };
}

async function start(options = {}) {
  const worker = await createBrowserWorkerServer({
    internalToken: 'worker-secret',
    browser: browserFake(),
    ...options,
  });
  workers.push(worker);
  return worker;
}

function workerFetch(worker, path, options = {}) {
  return fetch(`http://127.0.0.1:${worker.port}${path}`, options);
}

function rawRequest(worker, path, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: worker.port, path, method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.once('error', reject);
    req.end(body);
  });
}

describe('browser worker server', () => {
  it('listens on loopback and requires its internal token', async () => {
    const worker = await start();

    expect(worker.host).toBe('127.0.0.1');
    await expect(workerFetch(worker, '/_browser-worker/health')).resolves.toMatchObject({ status: 401 });
    const health = await workerFetch(worker, '/_browser-worker/health', {
      headers: { 'x-handmux-browser-internal': 'worker-secret' },
    });
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });
  });

  it('keeps the public Host/X-Forwarded-Proto when serving browser APIs', async () => {
    const browser = browserFake();
    const worker = await start({ browser });
    const body = JSON.stringify({ url: 'https://target.example/', closeAfterMinutes: 10 });
    const response = await rawRequest(worker, '/api/browser-tabs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-handmux-browser-internal': 'worker-secret',
        'x-handmux-browser-device': DEVICE,
        host: 'phone.example:30443',
        'x-forwarded-proto': 'https',
      },
      body,
    });

    expect(response.status).toBe(201);
    expect(browser.create).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'https://phone.example:30443', deviceId: DEVICE,
    }));
  });

  it('removes the internal token before public HTTP dispatch', async () => {
    const seen = [];
    const worker = await start({
      browserPublicFactory: () => ({
        handler(req, res) {
          seen.push(req.headers['x-handmux-browser-internal']);
          res.end('proxied');
        },
        onUpgrade: () => false,
      }),
    });
    const response = await workerFetch(worker, '/_browser-tab-a/https://target.example/', {
      headers: { 'x-handmux-browser-internal': 'worker-secret' },
    });

    expect(await response.text()).toBe('proxied');
    expect(seen).toEqual([undefined]);
  });

  it('authenticates upgrades separately and strips the internal token', async () => {
    const onUpgrade = vi.fn((_req, socket) => {
      socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
      return true;
    });
    const worker = await start({
      browserPublicFactory: () => ({ handler: (_req, _res, next) => next(), onUpgrade }),
    });
    const response = await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: worker.port });
      let data = '';
      socket.setEncoding('utf8');
      socket.once('connect', () => socket.write([
        'GET /messaging HTTP/1.1',
        'Host: phone.example',
        'Connection: Upgrade',
        'Upgrade: websocket',
        'X-Handmux-Browser-Internal: worker-secret',
        '', '',
      ].join('\r\n')));
      socket.on('data', (chunk) => { data += chunk; });
      socket.once('end', () => resolve(data));
      socket.once('error', reject);
    });

    expect(response).toContain('101 Switching Protocols');
    expect(onUpgrade).toHaveBeenCalledOnce();
    expect(onUpgrade.mock.calls[0][0].headers['x-handmux-browser-internal']).toBeUndefined();
  });

  it('closes the browser manager exactly once', async () => {
    const browser = browserFake();
    const worker = await start({ browser });

    await Promise.all([worker.close(), worker.close()]);

    expect(browser.close).toHaveBeenCalledOnce();
  });
});
