import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserWorkerClient } from '../src/browser/workerClient.js';

const clients = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

function child() {
  const value = new EventEmitter();
  value.kill = vi.fn(() => {
    queueMicrotask(() => value.emit('exit', 0, 'SIGTERM'));
    return true;
  });
  return value;
}

describe('browser proxy worker generation', () => {
  it('changes generation on ready and invalidates it immediately on worker exit', async () => {
    const spawned = child();
    const client = createBrowserWorkerClient({
      appToken: 'secret',
      previewDomain: 'preview.example',
      forkWorker: () => spawned,
      randomToken: () => 'internal',
    });
    clients.push(client);
    const app = express();
    app.use('/api/browser-proxy', client.apiHandler);

    await request(app).get('/api/browser-proxy/status')
      .expect(200, { ready: false, generation: 0 });

    spawned.emit('message', { type: 'handmux-browser-ready', port: 41001 });
    await request(app).get('/api/browser-proxy/status')
      .expect(200, { ready: true, generation: 1 });

    spawned.emit('exit', 1, null);
    await request(app).get('/api/browser-proxy/status')
      .expect(200, { ready: false, generation: 2 });
  });
});
