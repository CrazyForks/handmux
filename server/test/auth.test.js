import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { loadToken, tokenEquals, bearerFrom, expressAuth } from '../src/auth.js';

describe('token helpers', () => {
  it('loads token from env when present', () => {
    expect(loadToken({ HANDMUX_TOKEN: 'abc' })).toBe('abc');
  });
  it('generates a token when env empty', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const t = loadToken({});
    expect(t).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    log.mockRestore();
  });
  it('compares tokens', () => {
    expect(tokenEquals('s3cret', 's3cret')).toBe(true);
    expect(tokenEquals('s3cret', 'nope')).toBe(false);
  });
  it('parses bearer header', () => {
    expect(bearerFrom('Bearer xyz')).toBe('xyz');
    expect(bearerFrom('Basic xyz')).toBe(null);
    expect(bearerFrom(undefined)).toBe(null);
  });
});

describe('expressAuth middleware', () => {
  const app = express();
  app.use(expressAuth('good'));
  app.get('/x', (req, res) => res.json({ ok: true }));

  it('rejects missing/wrong token with 401', async () => {
    await request(app).get('/x').expect(401);
    await request(app).get('/x').set('Authorization', 'Bearer bad').expect(401);
  });
  it('accepts correct token', async () => {
    await request(app).get('/x').set('Authorization', 'Bearer good').expect(200);
  });
});
