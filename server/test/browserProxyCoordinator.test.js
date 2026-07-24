import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createBrowserCoordinator } from '../src/browser/coordinator.js';

const DEVICE = 'device_abcdefghijklmnopqrstuvwxyz123456';

function appFor(options) {
  const app = express();
  app.use(express.json());
  app.use(createBrowserCoordinator(options));
  return app;
}

describe('browser proxy coordinator', () => {
  it('answers status from the main process without a worker request', async () => {
    const proxyRequest = vi.fn();
    const app = appFor({
      proxyRequest,
      getStatus: () => ({ ready: false, generation: 4 }),
    });

    await request(app).get('/status').expect(200, { ready: false, generation: 4 });
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('forwards lease APIs and stamps the current main-process generation', async () => {
    const proxyRequest = vi.fn(async ({ path }) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({
        tabId: 'client-a',
        url: 'https://bootstrap.example/ticket',
        originalUrl: 'https://app.example/',
        channel: 'channel-a',
        workerPath: path,
      })),
    }));
    const app = appFor({
      proxyRequest,
      getStatus: () => ({ ready: true, generation: 9 }),
    });

    const response = await request(app).put('/leases/client-a')
      .set('X-Handmux-Browser-Device', DEVICE)
      .send({ url: 'https://app.example/' })
      .expect(200);

    expect(proxyRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'PUT',
      path: '/api/browser-proxy/leases/client-a',
      body: { url: 'https://app.example/' },
    }));
    expect(response.body).toMatchObject({
      tabId: 'client-a',
      url: 'https://bootstrap.example/ticket',
      generation: 9,
    });
  });
});
