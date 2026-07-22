import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserTab,
  deleteBrowserTab,
  getBrowserTabs,
  navigateBrowserTab,
  setBrowserTabVisible,
} from '../src/api.js';

afterEach(() => vi.unstubAllGlobals());

const response = (status, body = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

describe('browser API client', () => {
  it('maps tab lifecycle calls to the authenticated browser endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(201, { id: 'a' }))
      .mockResolvedValueOnce(response(200, { tabs: [{ id: 'a' }] }))
      .mockResolvedValueOnce(response(200, { id: 'a', visible: false }))
      .mockResolvedValueOnce(response(200, { id: 'a', originalUrl: 'https://b.example/' }))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal('fetch', fetchMock);

    await createBrowserTab('https://a.example/', 10);
    await getBrowserTabs();
    await setBrowserTabVisible('a', false, 30);
    await navigateBrowserTab('a', 'https://b.example/');
    await deleteBrowserTab('a');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/browser-tabs',
      '/api/browser-tabs',
      '/api/browser-tabs/a/visibility',
      '/api/browser-tabs/a/navigate',
      '/api/browser-tabs/a',
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST', body: JSON.stringify({ url: 'https://a.example/', closeAfterMinutes: 10 }),
    });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: 'PATCH', body: JSON.stringify({ visible: false, closeAfterMinutes: 30 }),
    });
    expect(fetchMock.mock.calls[3][1]).toMatchObject({
      method: 'POST', body: JSON.stringify({ url: 'https://b.example/' }),
    });
    expect(fetchMock.mock.calls[4][1]).toMatchObject({ method: 'DELETE' });
  });
});
