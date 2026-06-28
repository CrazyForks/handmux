import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// Load and execute the REAL public/sw.js with mocked worker globals (self/caches/fetch), capturing
// the install/activate/fetch handlers it registers. Testing the actual shipped file (not a copy)
// means the tests can't silently drift from production. Note: globals other than these (Promise,
// etc.) are the real Node ones — fine because sw.js only touches self/caches/fetch.
function loadSW({ fetchImpl, caches } = {}) {
  const src = readFileSync(path.resolve(here, '../public/sw.js'), 'utf8');
  const handlers = {};
  const self = {
    addEventListener: (type, h) => { handlers[type] = h; },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(() => Promise.resolve()) },
  };
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', src)(self, caches, fetchImpl);
  return { handlers, self };
}

describe('service worker', () => {
  it('serves the network response for a navigation when the network is up', async () => {
    const netResponse = { __net: true };
    const { handlers } = loadSW({
      fetchImpl: vi.fn(() => Promise.resolve(netResponse)),
      caches: { match: vi.fn() },
    });
    const event = { request: { mode: 'navigate' }, respondWith(p) { this.responded = p; } };
    handlers.fetch(event);
    await expect(event.responded).resolves.toBe(netResponse);
  });

  it('falls back to the cached offline page when a navigation fetch rejects', async () => {
    const offline = { __offline: true };
    const caches = { match: vi.fn(() => Promise.resolve(offline)) };
    const { handlers } = loadSW({
      fetchImpl: vi.fn(() => Promise.reject(new Error('ERR_NETWORK_CHANGED'))),
      caches,
    });
    const event = { request: { mode: 'navigate' }, respondWith(p) { this.responded = p; } };
    handlers.fetch(event);
    await expect(event.responded).resolves.toBe(offline);
    expect(caches.match).toHaveBeenCalledWith('/offline.html');
  });

  it('does not intercept non-navigation requests (assets / api stay on the network)', () => {
    const fetchImpl = vi.fn();
    const { handlers } = loadSW({ fetchImpl, caches: { match: vi.fn() } });
    const event = { request: { mode: 'cors' }, respondWith: vi.fn() };
    handlers.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('precaches the offline page and activates immediately on install', async () => {
    const add = vi.fn(() => Promise.resolve());
    const caches = { open: vi.fn(() => Promise.resolve({ add })) };
    const { handlers, self } = loadSW({ caches });
    const event = { waitUntil(p) { this.waited = p; } };
    handlers.install(event);
    await event.waited;
    expect(caches.open).toHaveBeenCalledWith('tmw-offline-v1');
    expect(add).toHaveBeenCalledWith('/offline.html');
    expect(self.skipWaiting).toHaveBeenCalled();
  });

  it('deletes stale caches and claims clients on activate', async () => {
    const del = vi.fn(() => Promise.resolve());
    const caches = {
      keys: vi.fn(() => Promise.resolve(['tmw-offline-v1', 'tmw-old'])),
      delete: del,
    };
    const { handlers, self } = loadSW({ caches });
    const event = { waitUntil(p) { this.waited = p; } };
    handlers.activate(event);
    await event.waited;
    expect(del).toHaveBeenCalledWith('tmw-old');
    expect(del).not.toHaveBeenCalledWith('tmw-offline-v1');
    expect(self.clients.claim).toHaveBeenCalled();
  });
});
