import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserTab,
  deleteBrowserTab,
  getBrowserTabs,
  navigateBrowserTab,
  setBrowserTabVisible,
  updateBrowserTabMeta,
} from '../src/api.js';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const response = (status, body = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

describe('browser API client', () => {
  it('can abort a pending browser request', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));

    const pending = createBrowserTab('https://a.example/', 10, 'direct', { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('maps tab lifecycle calls to the authenticated browser endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(201, { id: 'a' }))
      .mockResolvedValueOnce(response(200, { tabs: [{ id: 'a' }] }))
      .mockResolvedValueOnce(response(200, { id: 'a', visible: false }))
      .mockResolvedValueOnce(response(200, { id: 'a', originalUrl: 'https://b.example/' }))
      .mockResolvedValueOnce(response(200, { id: 'a', originalUrl: 'https://b.example/page' }))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal('fetch', fetchMock);

    await createBrowserTab('https://a.example/', 10, 'proxy');
    await getBrowserTabs();
    await setBrowserTabVisible('a', false, 30);
    await navigateBrowserTab('a', 'https://b.example/', 'direct');
    await updateBrowserTabMeta('a', 'https://b.example/page', 'Page');
    await deleteBrowserTab('a');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/browser-tabs',
      '/api/browser-tabs',
      '/api/browser-tabs/a/visibility',
      '/api/browser-tabs/a/navigate',
      '/api/browser-tabs/a/metadata',
      '/api/browser-tabs/a',
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST', body: JSON.stringify({ url: 'https://a.example/', closeAfterMinutes: 10, mode: 'proxy' }),
    });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: 'PATCH', body: JSON.stringify({ visible: false, closeAfterMinutes: 30 }),
    });
    expect(fetchMock.mock.calls[3][1]).toMatchObject({
      method: 'POST', body: JSON.stringify({ url: 'https://b.example/', mode: 'direct' }),
    });
    expect(fetchMock.mock.calls[4][1]).toMatchObject({
      method: 'PATCH', body: JSON.stringify({ url: 'https://b.example/page', title: 'Page' }),
    });
    expect(fetchMock.mock.calls[5][1]).toMatchObject({ method: 'DELETE' });
    const deviceIds = fetchMock.mock.calls.map(([, options]) => options.headers['X-Handmux-Browser-Device']);
    expect(deviceIds.every((id) => /^[A-Za-z0-9_-]{32,128}$/.test(id))).toBe(true);
    expect(new Set(deviceIds).size).toBe(1);
    expect(localStorage.getItem('hm_browser_device1')).toBe(deviceIds[0]);
  });
});
