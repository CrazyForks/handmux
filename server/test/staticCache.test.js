import { describe, it, expect } from 'vitest';
import { cacheControlFor } from '../src/staticCache.js';

describe('cacheControlFor', () => {
  it('never caches index.html (stale-shell trap)', () => {
    expect(cacheControlFor('/srv/dist/index.html')).toBe('no-store');
  });

  it('never caches the service worker', () => {
    expect(cacheControlFor('/srv/dist/sw.js')).toBe('no-store');
  });

  it('caches content-hashed /assets/ output forever', () => {
    expect(cacheControlFor('/srv/dist/assets/index-abc123.js'))
      .toBe('public, max-age=31536000, immutable');
    expect(cacheControlFor('/srv/dist/assets/index-abc123.css'))
      .toBe('public, max-age=31536000, immutable');
  });

  it('revalidates stable-url public assets (icons/manifest/favicon/og) instead of pinning them', () => {
    // These keep a stable URL but their bytes change across releases — immutable would freeze an old
    // copy in returning browsers for a year (the stale-icon bug).
    for (const p of [
      '/srv/dist/icons/icon-512.png',
      '/srv/dist/icons/apple-touch-icon.png',
      '/srv/dist/manifest.webmanifest',
      '/srv/dist/favicon.svg',
      '/srv/dist/og-card.png',
    ]) {
      expect(cacheControlFor(p)).toBe('no-cache');
    }
  });
});
