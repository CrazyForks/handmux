import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireBrowserProxyLease,
  deleteBrowserProxyLease,
  getBrowserProxyStatus,
  navigateBrowserProxyLease,
} from '../src/api.js';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const response = (status, body = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

describe('browser API client', () => {
  it('maps only proxy runtime calls to lease endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { tabId: 'a' }))
      .mockResolvedValueOnce(response(200, { tabId: 'a' }))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal('fetch', fetchMock);

    await acquireBrowserProxyLease('a', 'https://a.example/');
    await navigateBrowserProxyLease('a', 'https://b.example/');
    await deleteBrowserProxyLease('a');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/browser-proxy/leases/a',
      '/api/browser-proxy/leases/a/navigate',
      '/api/browser-proxy/leases/a',
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PUT', body: JSON.stringify({ url: 'https://a.example/' }),
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST', body: JSON.stringify({ url: 'https://b.example/' }),
    });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
    const deviceIds = fetchMock.mock.calls.map(([, options]) => options.headers['X-Handmux-Browser-Device']);
    expect(deviceIds.every((id) => /^[A-Za-z0-9_-]{32,128}$/.test(id))).toBe(true);
    expect(new Set(deviceIds).size).toBe(1);
    expect(localStorage.getItem('hm_browser_device1')).toBe(deviceIds[0]);
  });

  it('reads proxy readiness without loading device tabs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { ready: true, generation: 4 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getBrowserProxyStatus()).resolves.toEqual({ ready: true, generation: 4 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/browser-proxy/status');
  });
});
