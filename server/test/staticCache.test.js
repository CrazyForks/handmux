import { describe, it, expect } from 'vitest';
import { cacheControlFor } from '../src/staticCache.js';

describe('cacheControlFor', () => {
  it('never caches index.html (stale-shell trap)', () => {
    expect(cacheControlFor('/srv/dist/index.html')).toBe('no-store');
  });

  it('never caches the service worker', () => {
    expect(cacheControlFor('/srv/dist/sw.js')).toBe('no-store');
  });

  it('caches content-hashed assets forever', () => {
    expect(cacheControlFor('/srv/dist/assets/index-abc123.js'))
      .toBe('public, max-age=31536000, immutable');
    expect(cacheControlFor('/srv/dist/assets/index-abc123.css'))
      .toBe('public, max-age=31536000, immutable');
  });
});
