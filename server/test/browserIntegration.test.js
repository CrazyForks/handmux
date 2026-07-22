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
  it('loads and rewrites a loopback website through two concurrent Handmux origins', async () => {
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
      const secondOrigin = `http://localhost:${outerPort}`;
      const secondTab = await manager.create({
        url: `http://127.0.0.1:${targetPort}/second`,
        origin: secondOrigin,
        closeAfterMinutes: 10,
        deviceId,
      });
      const headers = { accept: 'text/html', cookie: `tw_browser_device=${deviceId}` };
      const secondHeaders = { accept: 'text/html', cookie: `tw_browser_device=${deviceId}` };
      const page = await fetch(tab.url, { headers });
      const secondPage = await fetch(secondTab.url, { headers: secondHeaders });
      const html = await page.text();
      const secondHtml = await secondPage.text();
      const asset = await fetch(`${origin}/hammerhead.js`, { headers });
      const secondAsset = await fetch(`${secondOrigin}/hammerhead.js`, { headers: secondHeaders });
      const crossOriginSession = await fetch(`${secondOrigin}${new URL(tab.url).pathname}`, { headers: secondHeaders });

      expect(page.status).toBe(200);
      expect(secondPage.status).toBe(200);
      expect(html).toContain('Internal App');
      expect(secondHtml).toContain('Internal App');
      expect(html).toContain('/hammerhead.js');
      expect(secondHtml).toContain('/hammerhead.js');
      expect(asset.status).toBe(200);
      expect(secondAsset.status).toBe(200);
      expect(crossOriginSession.status).toBe(403);
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
});
