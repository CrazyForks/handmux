import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCookie, credOk, createPreview } from '../src/previewServer.js';

describe('parseCookie', () => {
  it('reads a named cookie, decodes it, ignores others', () => {
    expect(parseCookie('a=1; tw_preview=ab%20c; b=2', 'tw_preview')).toBe('ab c');
  });
  it('returns null when absent / header missing', () => {
    expect(parseCookie('a=1', 'tw_preview')).toBeNull();
    expect(parseCookie(undefined, 'tw_preview')).toBeNull();
  });
});

describe('credOk', () => {
  const token = 'sekret';
  it('accepts a valid query token or cookie', () => {
    expect(credOk({ query: { token }, headers: {} }, token)).toBe(true);
    expect(credOk({ query: {}, headers: { cookie: `tw_preview=${token}` } }, token)).toBe(true);
  });
  it('rejects wrong or missing credentials', () => {
    expect(credOk({ query: { token: 'nope' }, headers: {} }, token)).toBe(false);
    expect(credOk({ query: {}, headers: {} }, token)).toBe(false);
  });
});

describe('createPreview static serving', () => {
  let site;
  let app;
  const token = 'good';
  const previews = {
    get: (name) => name === 'live' ? { state: 'active', entry: { dir: site } }
      : name === 'dead' ? { state: 'expired' } : { state: 'missing' },
  };

  beforeAll(async () => {
    site = await fsp.mkdtemp(join(tmpdir(), 'pvsite-'));
    await fsp.writeFile(join(site, 'index.html'), '<h1>hi</h1>');
    await fsp.mkdir(join(site, 'assets'));
    await fsp.writeFile(join(site, 'assets', 'app.js'), 'console.log(1)');
    const { router, refererFallback } = createPreview({ previews, token });
    app = express();
    app.use('/preview', router);
    app.use(refererFallback);
    app.use((req, res) => res.status(599).send('FELL_THROUGH'));
  });

  afterAll(async () => { await fsp.rm(site, { recursive: true, force: true }); });

  it('requires credentials', async () => {
    await request(app).get('/preview/live/').expect(401);
  });
  it('sets a cookie and strips the first-visit token', async () => {
    const res = await request(app).get('/preview/live/?token=good').expect(302);
    expect(res.headers['set-cookie'][0]).toMatch(/tw_preview=good; Path=\/; HttpOnly/);
    expect(res.headers.location).toBe('/preview/live/');
  });
  it('serves the directory and its assets without caching', async () => {
    const page = await request(app).get('/preview/live/').set('Cookie', 'tw_preview=good').expect(200);
    expect(page.text).toContain('hi');
    expect(page.headers['cache-control']).toBe('no-store');
    const asset = await request(app).get('/preview/live/assets/app.js').set('Cookie', 'tw_preview=good').expect(200);
    expect(asset.text).toContain('console.log');
  });
  it('redirects a no-slash preview path', async () => {
    const res = await request(app).get('/preview/live').set('Cookie', 'tw_preview=good').expect(301);
    expect(res.headers.location).toBe('/preview/live/');
  });
  it('reports expired and missing previews', async () => {
    await request(app).get('/preview/dead/').set('Cookie', 'tw_preview=good').expect(410);
    await request(app).get('/preview/ghost/').set('Cookie', 'tw_preview=good').expect(404);
  });
  it('serves an absolute asset path only with an authenticated preview referer', async () => {
    const asset = await request(app).get('/assets/app.js')
      .set('Cookie', 'tw_preview=good').set('Referer', 'http://x/preview/live/').expect(200);
    expect(asset.text).toContain('console.log');
    await request(app).get('/assets/app.js').set('Referer', 'http://x/preview/live/').expect(599);
    await request(app).get('/assets/app.js').set('Cookie', 'tw_preview=good').expect(599);
  });
});
