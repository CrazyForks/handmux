import http from 'node:http';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createBrowserPublicProxy, isBrowserServicePath } from '../src/browser/publicProxy.js';

const servers = [];

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return server.address().port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('browser public proxy', () => {
  it.each(['/hammerhead.js', '/task.js', '/iframe-task.js', '/messaging', '/transport-worker.js', '/worker-hammerhead.js'])(
    'recognizes Hammerhead service route %s',
    (path) => expect(isBrowserServicePath(path)).toBe(true),
  );

  it('falls through for ordinary Handmux routes', async () => {
    const browser = { internalPorts: [1, 2], ownsPublicPath: () => false };
    const proxy = createBrowserPublicProxy({ browser, token: 'handmux-secret' });
    const app = express();
    app.use(proxy.handler);
    app.get('*', (_req, res) => res.status(218).send('handmux'));

    const res = await request(app).get('/api/states');

    expect(res.status).toBe(218);
    expect(res.text).toBe('handmux');
  });

  it('preserves target Authorization while removing only the Handmux bearer token', async () => {
    const received = [];
    const upstream = http.createServer((req, res) => {
      received.push(req.headers.authorization);
      res.end('proxied');
    });
    const port = await listen(upstream);
    const browser = { internalPorts: [port, port + 1], ownsPublicPath: () => true };
    const proxy = createBrowserPublicProxy({ browser, token: 'handmux-secret' });
    const app = express();
    app.use(proxy.handler);

    await request(app).get('/_browser-tab-a/https://target.example/').set('Authorization', 'Bearer handmux-secret');
    await request(app).get('/_browser-tab-a/https://target.example/').set('Authorization', 'Basic dXNlcjpwYXNz');

    expect(received).toEqual([undefined, 'Basic dXNlcjpwYXNz']);
  });

  it('forwards active session paths and service assets to Hammerhead loopback', async () => {
    const received = [];
    const upstream = http.createServer((req, res) => {
      received.push({ url: req.url, headers: req.headers });
      res.setHeader('x-upstream', 'hammerhead');
      res.end('proxied');
    });
    const port = await listen(upstream);
    const browser = {
      internalPorts: [port, port + 1],
      ownsPublicPath: (path) => path.startsWith('/_browser-tab-a/'),
    };
    const proxy = createBrowserPublicProxy({ browser, token: 'handmux-secret' });
    const app = express();
    app.use(proxy.handler);

    const page = await request(app)
      .get('/_browser-tab-a/https://target.example/')
      .set('Authorization', 'Bearer handmux-secret')
      .set('Cookie', 'tw_preview=handmux-secret; hammerhead-sync=value');
    const asset = await request(app).get('/hammerhead.js');

    expect(page.status).toBe(200);
    expect(page.text).toBe('proxied');
    expect(asset.status).toBe(200);
    expect(received.map((item) => item.url)).toEqual(['/_browser-tab-a/https://target.example/', '/hammerhead.js']);
    expect(received[0].headers.authorization).toBeUndefined();
    expect(received[0].headers.cookie).toBe('hammerhead-sync=value');
    expect(received[0].headers.host).toBe(`127.0.0.1:${port}`);
  });

  it('returns a specific 502 when the internal proxy is unavailable', async () => {
    const browser = { internalPorts: [9, 10], ownsPublicPath: () => true };
    const proxy = createBrowserPublicProxy({ browser });
    const app = express();
    app.use(proxy.handler);

    const res = await request(app).get('/_browser-tab-a/https://target.example/');

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/browser proxy unavailable/i);
  });
});
