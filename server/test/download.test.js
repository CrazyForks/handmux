// server/test/download.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiRouter } from '../src/httpApi.js';
import { createDocs } from '../src/docs.js';

let home, app;
const auth = (r) => r.set('Authorization', 'Bearer good');

beforeAll(async () => {
  home = await fs.mkdtemp(join(tmpdir(), 'twdl-'));
  await fs.mkdir(join(home, 'sub'));
  await fs.writeFile(join(home, 'sub', 'data.bin'), Buffer.from('hello-bytes'));
  await fs.writeFile(join(home, 'sub', 'big.bin'), Buffer.alloc(64, 7));
  app = express();
  app.use('/api', createApiRouter({
    token: 'good', commands: {},
    docs: createDocs({ home, maxDownloadBytes: 16 }), // tiny cap → big.bin trips 413
  }));
});
afterAll(async () => { await fs.rm(home, { recursive: true, force: true }); });

describe('GET /api/download', () => {
  it('requires auth', async () => {
    await request(app).get(`/api/download?path=${encodeURIComponent(join(home, 'sub', 'data.bin'))}`).expect(401);
  });
  it('streams the file as an attachment', async () => {
    const res = await auth(request(app).get(`/api/download?path=${encodeURIComponent(join(home, 'sub', 'data.bin'))}`)).expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/data\.bin/);
    expect(res.body.toString()).toBe('hello-bytes');
  });
  it('404s a missing file', async () => {
    await auth(request(app).get(`/api/download?path=${encodeURIComponent(join(home, 'sub', 'nope.bin'))}`)).expect(404);
  });
  it('400s a path outside home', async () => {
    await auth(request(app).get('/api/download?path=/etc/passwd')).expect(400);
  });
  it('413s a file over the cap', async () => {
    await auth(request(app).get(`/api/download?path=${encodeURIComponent(join(home, 'sub', 'big.bin'))}`)).expect(413);
  });
  it('sets X-Mtime on the streamed bytes (drives the image viewer\'s conditional refresh)', async () => {
    const res = await auth(request(app).get(`/api/download?path=${encodeURIComponent(join(home, 'sub', 'data.bin'))}`)).expect(200);
    expect(Number(res.headers['x-mtime'])).toBeGreaterThan(0);
  });
  it('conditional: matching ?mtime → 304 (no re-stream); a stale mtime streams the bytes again', async () => {
    const p = encodeURIComponent(join(home, 'sub', 'data.bin'));
    const first = await auth(request(app).get(`/api/download?path=${p}`)).expect(200);
    const m = first.headers['x-mtime'];
    await auth(request(app).get(`/api/download?path=${p}&mtime=${m}`)).expect(304);
    const changed = await auth(request(app).get(`/api/download?path=${p}&mtime=1`)).expect(200);
    expect(changed.body.toString()).toBe('hello-bytes');
  });
});
