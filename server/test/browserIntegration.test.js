import http from 'node:http';
import express from 'express';
import { describe, expect, it } from 'vitest';
import hammerhead from 'testcafe-hammerhead';
import { createBrowserPreviewManager } from '../src/browser/manager.js';
import { createBrowserPublicProxy } from '../src/browser/publicProxy.js';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

describe('built-in browser vertical slice', () => {
  it('loads one target origin through isolated sessions for two devices', async () => {
    const target = http.createServer((_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>Internal App</title><main id="loaded">working</main>');
    });
    const targetPort = await listen(target);
    const manager = await createBrowserPreviewManager({ hammerhead });
    const publicProxy = createBrowserPublicProxy({ browser: manager });
    const app = express();
    app.use(publicProxy.handler);
    const outer = http.createServer(app);
    outer.on('upgrade', publicProxy.onUpgrade);
    const outerPort = await listen(outer);

    try {
      const origin = `http://127.0.0.1:${outerPort}`;
      const deviceId = 'device_abcdefghijklmnopqrstuvwxyz123456';
      const tab = await manager.create({
        url: `http://127.0.0.1:${targetPort}/keys`,
        origin,
        closeAfterMinutes: 10,
        deviceId,
      });
      const secondDeviceId = 'device_zyxwvutsrqponmlkjihgfedcba654321';
      const secondTab = await manager.create({
        url: `http://127.0.0.1:${targetPort}/second`,
        origin,
        closeAfterMinutes: 10,
        deviceId: secondDeviceId,
      });
      const headers = { accept: 'text/html', cookie: `tw_browser_device=${deviceId}` };
      const secondHeaders = { accept: 'text/html', cookie: `tw_browser_device=${secondDeviceId}` };
      const page = await fetch(tab.url, { headers });
      const secondPage = await fetch(secondTab.url, { headers: secondHeaders });
      const html = await page.text();
      const secondHtml = await secondPage.text();
      const asset = await fetch(`${origin}/hammerhead.js`, { headers });
      const secondAsset = await fetch(`${origin}/hammerhead.js`, { headers: secondHeaders });
      const crossDeviceSession = await fetch(`${origin}${new URL(tab.url).pathname}`, { headers: secondHeaders });

      expect(page.status).toBe(200);
      expect(secondPage.status).toBe(200);
      expect(html).toContain('Internal App');
      expect(secondHtml).toContain('Internal App');
      expect(html).toContain('/hammerhead.js');
      expect(secondHtml).toContain('/hammerhead.js');
      expect(asset.status).toBe(200);
      expect(secondAsset.status).toBe(200);
      expect(crossDeviceSession.status).toBe(403);
      await secondAsset.body.cancel();
      const reader = asset.body.getReader();
      let assetBytes = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        assetBytes += chunk.value.length;
      }
      expect(assetBytes).toBeGreaterThan(1_000_000);
    } finally {
      await manager.close();
      await Promise.all([close(outer), close(target)]);
    }
  });

  it('shares target cookies across same-device tabs while keeping distinct Hammerhead windows', async () => {
    const target = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (req.url === '/set') res.setHeader('set-cookie', 'shared=yes; Path=/');
      res.end(`<!doctype html><title>Cookies</title><main>${req.headers.cookie || ''}</main>`);
    });
    const targetPort = await listen(target);
    const manager = await createBrowserPreviewManager({ hammerhead });
    const publicProxy = createBrowserPublicProxy({ browser: manager });
    const app = express();
    app.use(publicProxy.handler);
    const outer = http.createServer(app);
    const outerPort = await listen(outer);

    try {
      const origin = `http://127.0.0.1:${outerPort}`;
      const deviceId = 'device_abcdefghijklmnopqrstuvwxyz123456';
      const first = await manager.create({
        url: `http://127.0.0.1:${targetPort}/set`, origin, closeAfterMinutes: 10, deviceId,
      });
      const second = await manager.create({
        url: `http://127.0.0.1:${targetPort}/read`, origin, closeAfterMinutes: 10, deviceId,
      });
      const headers = { accept: 'text/html', cookie: `tw_browser_device=${deviceId}` };
      const firstHtml = await (await fetch(first.url, { headers })).text();
      const secondHtml = await (await fetch(second.url, { headers })).text();
      const firstTask = await (await fetch(`${origin}/task.js`, { headers: { ...headers, referer: first.url } })).text();
      const secondTask = await (await fetch(`${origin}/task.js`, { headers: { ...headers, referer: second.url } })).text();

      expect(first.channel).not.toBe(second.channel);
      expect(first.url).toContain(`*${first.channel}`);
      expect(second.url).toContain(`*${second.channel}`);
      expect(firstTask).toContain(first.channel);
      expect(secondTask).toContain(second.channel);
      expect(secondHtml).toContain('shared=yes');
    } finally {
      await manager.close();
      await Promise.all([close(outer), close(target)]);
    }
  });
});
