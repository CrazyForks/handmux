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
  it('loads and rewrites a loopback website through the current Handmux origin', async () => {
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
      const tab = manager.create({
        url: `http://127.0.0.1:${targetPort}/keys`,
        origin,
        closeAfterMinutes: 10,
      });
      const page = await fetch(tab.url, { headers: { accept: 'text/html' } });
      const html = await page.text();
      const asset = await fetch(`${origin}/hammerhead.js`);

      expect(page.status).toBe(200);
      expect(html).toContain('Internal App');
      expect(html).toContain('/hammerhead.js');
      expect(asset.status).toBe(200);
      const reader = asset.body.getReader();
      let assetBytes = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        assetBytes += chunk.value.length;
      }
      expect(assetBytes).toBeGreaterThan(1_000_000);
    } finally {
      manager.close();
      await Promise.all([close(outer), close(target)]);
    }
  });
});
