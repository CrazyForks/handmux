// web/test/shareIntake.test.js
import { describe, it, expect, afterEach } from 'vitest';
import { hasShareFlag, clearShareFlag, takeSharedFile, SHARE_PREFIX } from '../src/shareIntake.js';

// Minimal stand-in for a CacheStorage entry: keys()/match()/delete()/put() over a Map keyed by the
// (absolute) request URL — same shape sw.js writes and takeSharedFile reads.
class FakeCache {
  constructor() { this.store = new Map(); }
  async put(key, res) { this.store.set(typeof key === 'string' ? key : key.url, res); }
  async keys() { return [...this.store.keys()].map((url) => ({ url })); }
  async match(req) { return this.store.get(req.url) ?? null; }
  async delete(req) { return this.store.delete(req.url); }
}
const origin = 'http://localhost';

afterEach(() => { delete globalThis.caches; });

describe('hasShareFlag', () => {
  it('detects the ?share flag, ignores anything else', () => {
    expect(hasShareFlag('?share=1')).toBe(true);
    expect(hasShareFlag('?share')).toBe(true);
    expect(hasShareFlag('?foo=1')).toBe(false);
    expect(hasShareFlag('')).toBe(false);
  });
});

describe('clearShareFlag', () => {
  it('strips ?share but keeps the path and hash', () => {
    history.replaceState(null, '', '/?share=1#/some/route');
    clearShareFlag();
    expect(location.search).toBe('');
    expect(location.hash).toBe('#/some/route');
  });
});

describe('takeSharedFile', () => {
  it('returns null when the Cache API is unavailable', async () => {
    delete globalThis.caches;
    expect(await takeSharedFile()).toBeNull();
  });

  it('returns null when nothing is stashed', async () => {
    const cache = new FakeCache();
    globalThis.caches = { open: async () => cache };
    expect(await takeSharedFile()).toBeNull();
  });

  it('reconstructs the File (UTF-8 name + type) and consumes the cache entry', async () => {
    const cache = new FakeCache();
    globalThis.caches = { open: async () => cache };
    // Mirror sw.js: key = SHARE_PREFIX + encodeURIComponent(name), body carries the bytes + type.
    const name = '中文报告.txt';
    await cache.put(
      `${origin}${SHARE_PREFIX}${encodeURIComponent(name)}`,
      new Response(new Blob(['hello'], { type: 'text/plain' })),
    );
    const file = await takeSharedFile();
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe(name);
    expect(file.type).toMatch(/^text\/plain/); // undici's Response may append ;charset=utf-8
    // (content/size round-trip is the platform's job and crosses realms in jsdom — not asserted here)
    // one-shot: a second call (e.g. a refresh) finds nothing
    expect(await takeSharedFile()).toBeNull();
  });
});
