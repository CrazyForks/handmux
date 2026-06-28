// server/test/previewServer.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import http from 'node:http';
import net from 'node:net';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCookie, credOk, createPreview, isPreviewHost } from '../src/previewServer.js';

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
  it('true for a valid query token', () => {
    expect(credOk({ query: { token: 'sekret' }, headers: {} }, token)).toBe(true);
  });
  it('true for a valid cookie', () => {
    expect(credOk({ query: {}, headers: { cookie: 'tw_preview=sekret' } }, token)).toBe(true);
  });
  it('false for wrong / missing creds', () => {
    expect(credOk({ query: { token: 'nope' }, headers: {} }, token)).toBe(false);
    expect(credOk({ query: {}, headers: {} }, token)).toBe(false);
  });
});

describe('isPreviewHost', () => {
  const D = 'preview.example.com';
  it('extracts the single-label name', () => {
    expect(isPreviewHost('foo.preview.example.com', D)).toBe('foo');
  });
  it('null for the base domain itself / a deeper subdomain / a foreign domain', () => {
    expect(isPreviewHost('preview.example.com', D)).toBeNull();
    expect(isPreviewHost('a.b.preview.example.com', D)).toBeNull();
    expect(isPreviewHost('foo.evil.com', D)).toBeNull();
  });
  it('null when domain is not configured', () => {
    expect(isPreviewHost('foo.preview.example.com', null)).toBeNull();
  });
  it('rejects an unsafe name label', () => {
    expect(isPreviewHost('..preview.example.com', D)).toBeNull();
  });
  it('ignores a :port in the configured domain (edge on a non-standard port)', () => {
    // incoming host is already port-stripped by the caller; the configured domain may carry the port.
    expect(isPreviewHost('foo.preview.example.com', 'preview.example.com:39999')).toBe('foo');
    expect(isPreviewHost('preview.example.com', 'preview.example.com:39999')).toBeNull();
  });
});

describe('createPreview serving', () => {
  let site, app;
  const TOKEN = 'good';
  // a fake registry: 'live' is active, 'dead' is expired, others missing.
  const previews = {
    get: (name) => name === 'live' ? { state: 'active', entry: { dir: site } }
                 : name === 'dead' ? { state: 'expired' }
                 : { state: 'missing' },
  };
  beforeAll(async () => {
    site = await fsp.mkdtemp(join(tmpdir(), 'pvsite-'));
    await fsp.writeFile(join(site, 'index.html'), '<h1>hi</h1>');
    await fsp.mkdir(join(site, 'assets'));
    await fsp.writeFile(join(site, 'assets', 'app.js'), 'console.log(1)');
    const { router, refererFallback } = createPreview({ previews, token: TOKEN });
    app = express();
    app.use('/preview', router);
    app.use(refererFallback);
    app.use((req, res) => res.status(599).send('FELL_THROUGH')); // sentinel: reached the SPA layer
  });
  afterAll(async () => { await fsp.rm(site, { recursive: true, force: true }); });

  it('401 without a token', async () => {
    await request(app).get('/preview/live/').expect(401);
  });
  it('sets cookie and 302-strips the token on first visit', async () => {
    const res = await request(app).get('/preview/live/?token=good').expect(302);
    expect(res.headers['set-cookie'][0]).toMatch(/tw_preview=good; Path=\/; HttpOnly/);
    expect(res.headers.location).toBe('/preview/live/');
  });
  it('serves index.html with a cookie (no-store)', async () => {
    const res = await request(app).get('/preview/live/').set('Cookie', 'tw_preview=good').expect(200);
    expect(res.text).toContain('hi');
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('redirects /preview/:name (no slash) to .../', async () => {
    await request(app).get('/preview/live?token=good').expect(302); // token branch first → then trailing-slash on next hit; just assert a redirect
  });
  it('redirects no-slash /preview/:name to .../ (cookie path → 301)', async () => {
    const res = await request(app).get('/preview/live').set('Cookie', 'tw_preview=good').expect(301);
    expect(res.headers.location).toBe('/preview/live/');
  });
  it('serves a sub-path asset through the authenticated /preview router', async () => {
    const res = await request(app).get('/preview/live/assets/app.js').set('Cookie', 'tw_preview=good').expect(200);
    expect(res.text).toContain('console.log');
  });
  it('410 for an expired preview', async () => {
    await request(app).get('/preview/dead/').set('Cookie', 'tw_preview=good').expect(410);
  });
  it('404 for a missing preview', async () => {
    await request(app).get('/preview/ghost/').set('Cookie', 'tw_preview=good').expect(404);
  });

  it('referer fallback serves an absolute /assets path from the preview dir', async () => {
    const res = await request(app).get('/assets/app.js')
      .set('Cookie', 'tw_preview=good')
      .set('Referer', 'http://x/preview/live/').expect(200);
    expect(res.text).toContain('console.log');
  });
  it('referer fallback WITHOUT creds falls through (no unauth dir read)', async () => {
    await request(app).get('/assets/app.js').set('Referer', 'http://x/preview/live/').expect(599);
  });
  it('no referer → falls through to the SPA layer', async () => {
    await request(app).get('/assets/app.js').set('Cookie', 'tw_preview=good').expect(599);
  });
  it('referer points at a preview but file absent → falls through', async () => {
    await request(app).get('/assets/missing.js')
      .set('Cookie', 'tw_preview=good').set('Referer', 'http://x/preview/live/').expect(599);
  });
});

describe('createPreview dynamic proxy (HTTP)', () => {
  const TOKEN = 'good';
  const DOMAIN = 'preview.test';
  let upstream, upPort, app;
  // a stub "dev server" that echoes method+url+body so we can assert pass-through fidelity
  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`${req.method} ${req.url} host=${req.headers.host} body=${body}`);
      });
    });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    upPort = upstream.address().port;
    const previews = {
      get: (name) => name === 'app' ? { state: 'active', entry: { kind: 'dynamic', port: upPort } }
                   : name === 'dead' ? { state: 'expired' }
                   : { state: 'missing' },
    };
    const { dynamicProxy } = createPreview({ previews, token: TOKEN, domain: DOMAIN });
    app = express();
    app.use(dynamicProxy);
    app.use((req, res) => res.status(599).send('FELL_THROUGH')); // non-preview host sentinel
  });
  afterAll(() => new Promise((r) => upstream.close(r)));

  const H = (sub) => `${sub}.${DOMAIN}`;

  it('401 on a preview host without creds', async () => {
    await request(app).get('/').set('Host', H('app')).expect(401);
  });
  it('sets a Domain-scoped cookie and 302-strips the token', async () => {
    const res = await request(app).get('/?token=good').set('Host', H('app')).expect(302);
    expect(res.headers['set-cookie'][0]).toMatch(/tw_preview=good; Domain=test; Path=\/; HttpOnly/);
    expect(res.headers.location).toBe('/');
  });
  it('proxies a GET to the upstream, forwarding path + rewriting Host to loopback', async () => {
    const res = await request(app).get('/api/data?x=1').set('Host', H('app')).set('Cookie', 'tw_preview=good').expect(200);
    expect(res.text).toBe(`GET /api/data?x=1 host=127.0.0.1:${upPort} body=`);
  });
  it('proxies a POST body through unchanged', async () => {
    const res = await request(app).post('/submit').set('Host', H('app')).set('Cookie', 'tw_preview=good')
      .set('Content-Type', 'text/plain').send('hello').expect(200);
    expect(res.text).toBe('POST /submit host=127.0.0.1:' + upPort + ' body=hello');
  });
  it('404 / 410 for missing / expired dynamic previews', async () => {
    await request(app).get('/').set('Host', H('ghost')).set('Cookie', 'tw_preview=good').expect(404);
    await request(app).get('/').set('Host', H('dead')).set('Cookie', 'tw_preview=good').expect(410);
  });
  it('a non-preview host falls through to the app (next)', async () => {
    await request(app).get('/').set('Host', 'example.test').set('Cookie', 'tw_preview=good').expect(599);
  });
});

describe('createPreview dynamic disabled (no domain)', () => {
  it('dynamicProxy is a pass-through when domain is null', async () => {
    const { dynamicProxy } = createPreview({ previews: { get: () => ({ state: 'missing' }) }, token: 'good', domain: null });
    const app = express();
    app.use(dynamicProxy);
    app.use((req, res) => res.status(599).end());
    await request(app).get('/').set('Host', 'foo.preview.test').expect(599);
  });
});

describe('createPreview onUpgrade (WS/raw socket)', () => {
  const TOKEN = 'good';
  const DOMAIN = 'preview.test';
  let stub, stubPort, server, port;
  // a stub upstream that, on connect, replies with the switching-protocols handshake then echoes bytes
  beforeAll(async () => {
    stub = net.createServer((sock) => {
      let sentHandshake = false;
      sock.on('data', (buf) => {
        if (!sentHandshake) {
          sentHandshake = true;
          sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
        } else {
          sock.write(buf); // echo subsequent frames
        }
      });
    });
    await new Promise((r) => stub.listen(0, '127.0.0.1', r));
    stubPort = stub.address().port;
    const previews = {
      get: (name) => name === 'app' ? { state: 'active', entry: { kind: 'dynamic', port: stubPort } } : { state: 'missing' },
    };
    const { onUpgrade } = createPreview({ previews, token: TOKEN, domain: DOMAIN });
    server = http.createServer((req, res) => res.end('http'));
    server.on('upgrade', onUpgrade);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); await new Promise((r) => stub.close(r)); });

  // Raw upgrade client: returns the bytes received until `onChunk` says stop.
  const upgrade = ({ host, cookie }) => new Promise((resolve, reject) => {
    const c = net.connect(port, '127.0.0.1', () => {
      c.write(`GET /socket HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${cookie ? `Cookie: ${cookie}\r\n` : ''}\r\n`);
    });
    let buf = '';
    c.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('101 Switching Protocols')) { resolve({ c, buf }); }
    });
    c.on('close', () => { if (!buf.includes('101')) reject(new Error(`closed: ${JSON.stringify(buf)}`)); });
    c.on('error', reject);
    setTimeout(() => reject(new Error('timeout')), 1500);
  });

  it('authorized upgrade completes the handshake and pipes bytes both ways', async () => {
    const { c } = await upgrade({ host: `app.${DOMAIN}`, cookie: 'tw_preview=good' });
    const echoed = await new Promise((resolve) => { c.once('data', (d) => resolve(d.toString())); c.write('ping'); });
    expect(echoed).toBe('ping');
    c.destroy();
  });
  it('an upgrade without creds is destroyed (no handshake)', async () => {
    await expect(upgrade({ host: `app.${DOMAIN}`, cookie: null })).rejects.toThrow();
  });
  it('an upgrade for a missing preview is destroyed', async () => {
    await expect(upgrade({ host: `ghost.${DOMAIN}`, cookie: 'tw_preview=good' })).rejects.toThrow();
  });
});
