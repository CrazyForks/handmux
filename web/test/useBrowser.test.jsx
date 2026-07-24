import { act } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  acquireBrowserProxyLease: vi.fn(),
  navigateBrowserProxyLease: vi.fn(),
  deleteBrowserProxyLease: vi.fn(),
  getBrowserProxyStatus: vi.fn(),
  setBrowserProxyProfilePrefs: vi.fn(),
  clearBrowserProxyProfile: vi.fn(),
}));
vi.mock('../src/api.js', () => api);

import {
  readBrowserHistory, readBrowserTabs, setPersistProxyLogin, writeBrowserTabs,
} from '../src/browserState.js';
import { useBrowser } from '../src/hooks/useBrowser.js';

const binding = (id, url, generation = 1) => ({
  tabId: id,
  url: `/api/browser-proxy/leases/${id}/bootstrap`,
  channel: `channel-${id}`,
  generation,
  originalUrl: url,
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('hm_browser_access1', '1');
  vi.clearAllMocks();
  api.acquireBrowserProxyLease.mockImplementation((id, url) => Promise.resolve(binding(id, url)));
  api.navigateBrowserProxyLease.mockImplementation((id, url) => Promise.resolve(binding(id, url)));
  api.deleteBrowserProxyLease.mockResolvedValue(undefined);
  api.getBrowserProxyStatus.mockResolvedValue({ ready: true, generation: 1 });
  api.setBrowserProxyProfilePrefs.mockResolvedValue({ persist: false, retentionDays: 30 });
  api.clearBrowserProxyProfile.mockResolvedValue({});
});

afterEach(() => cleanup());

describe('useBrowser device ownership', () => {
  it('does not revive persisted tabs while the built-in browser is disabled', async () => {
    localStorage.removeItem('hm_browser_access1');
    writeBrowserTabs({
      tabs: [{ id: 'old', mode: 'direct', originalUrl: 'https://old.example/', title: '', deadline: null }],
      activeId: 'old',
      open: true,
      historyActive: false,
    });
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.accessEnabled).toBe(false);
    expect(result.current.tabs).toEqual([]);
    expect(readBrowserTabs().tabs).toEqual([]);
  });

  it('consumes a pending direct URL only once across repeated enable confirmation', async () => {
    localStorage.removeItem('hm_browser_access1');
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await act(async () => { await result.current.openUrl('https://a.example/'); });

    let first;
    let second;
    act(() => {
      first = result.current.enableAccess();
      second = result.current.enableAccess();
    });
    expect(first).toBe(second);
    await act(async () => { await Promise.all([first, second]); });
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].originalUrl).toBe('https://a.example/');
  });

  it('applies latest-wins to same-tick direct opens', async () => {
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    let first;
    let second;
    act(() => {
      first = result.current.openUrl('https://old.example/', { mode: 'direct' });
      second = result.current.openUrl('https://new.example/', { mode: 'direct' });
    });
    await act(async () => { await Promise.all([first, second]); });
    expect(result.current.tabs.map((tab) => tab.originalUrl)).toEqual(['https://new.example/']);
  });

  it('keeps direct tab lifecycle local and restores it from device storage', async () => {
    const first = renderHook(() => useBrowser({ browserProxy: true }));
    let opened;
    await act(async () => { opened = await first.result.current.openUrl('example.com', { mode: 'direct' }); });

    expect(opened.originalUrl).toBe('https://example.com/');
    expect(opened.url).toBe('https://example.com/');
    expect(api.acquireBrowserProxyLease).not.toHaveBeenCalled();
    expect(readBrowserTabs().tabs).toEqual([
      expect.objectContaining({ id: opened.id, mode: 'direct', originalUrl: 'https://example.com/' }),
    ]);

    first.unmount();
    const restored = renderHook(() => useBrowser({ browserProxy: true }));
    expect(restored.result.current.tabs[0]).toMatchObject({
      id: opened.id, originalUrl: 'https://example.com/', url: 'https://example.com/',
    });
  });

  it('persists proxy identity but reacquires its runtime binding after remount', async () => {
    const first = renderHook(() => useBrowser({ browserProxy: true }));
    await act(async () => { await first.result.current.openUrl('https://a.example/', { mode: 'proxy' }); });
    const id = first.result.current.tabs[0].id;
    expect(readBrowserTabs().tabs[0]).not.toHaveProperty('url');

    first.unmount();
    api.acquireBrowserProxyLease.mockClear();
    const restored = renderHook(() => useBrowser({ browserProxy: true }));
    await act(async () => { await restored.result.current.ensureBinding(id); });
    expect(api.acquireBrowserProxyLease).toHaveBeenCalledWith(id, 'https://a.example/');
    expect(restored.result.current.tabs[0].url).toContain('/bootstrap');
  });

  it('syncs persisted profile preferences before the first acquire on a new worker', async () => {
    setPersistProxyLogin(true);
    const order = [];
    api.setBrowserProxyProfilePrefs.mockImplementation(async (prefs) => {
      order.push(['profile', prefs]);
      return prefs;
    });
    api.acquireBrowserProxyLease.mockImplementation(async (id, url) => {
      order.push(['acquire', url]);
      return binding(id, url);
    });
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));

    await act(async () => {
      await result.current.openUrl('https://a.example/', { mode: 'proxy' });
    });

    expect(order).toEqual([
      ['profile', { persist: true, retentionDays: 30 }],
      ['acquire', 'https://a.example/'],
    ]);
  });

  it('merges same-tick profile preference changes before the next acquire', async () => {
    const saved = [];
    api.setBrowserProxyProfilePrefs.mockImplementation(async (prefs) => {
      saved.push(prefs);
      return prefs;
    });
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    let persist;
    let retention;
    act(() => {
      persist = result.current.setPersistProxyLogin(true);
      retention = result.current.setProxyLoginRetentionDays(7);
    });
    await act(async () => { await Promise.all([persist, retention]); });
    await act(async () => {
      await result.current.openUrl('https://a.example/', { mode: 'proxy' });
    });

    expect(saved).toEqual([
      { persist: true, retentionDays: 30 },
      { persist: true, retentionDays: 7 },
      { persist: true, retentionDays: 7 },
    ]);
  });

  it('retains the tab when acquire fails and can explicitly recover it', async () => {
    api.acquireBrowserProxyLease.mockRejectedValueOnce(new Error('worker gone'));
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    let opened;
    await act(async () => { opened = await result.current.openUrl('https://a.example/', { mode: 'proxy' }); });

    expect(result.current.tabs).toEqual([
      expect.objectContaining({ id: opened.id, originalUrl: 'https://a.example/' }),
    ]);
    expect(result.current.tabs[0].url).toBeUndefined();

    await act(async () => { await result.current.recoverBinding(opened.id); });
    expect(result.current.tabs[0].url).toContain('/bootstrap');
  });

  it('invalidates runtime bindings on worker generation change without deleting tabs', async () => {
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await act(async () => {
      await Promise.resolve();
      await result.current.openUrl('https://a.example/', { mode: 'proxy' });
    });
    const id = result.current.activeId;
    api.getBrowserProxyStatus.mockResolvedValue({ ready: true, generation: 2 });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.tabs).toEqual([
      expect.objectContaining({ id, originalUrl: 'https://a.example/' }),
    ]);
    expect(result.current.tabs[0].url).toBeUndefined();
    expect(api.deleteBrowserProxyLease).not.toHaveBeenCalled();
  });

  it('does not reacquire an already-mounted proxy tab just because it is switched', async () => {
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await act(async () => { await result.current.openUrl('https://a.example/', { mode: 'proxy' }); });
    const firstId = result.current.activeId;
    await act(async () => { await result.current.openUrl('https://b.example/', { mode: 'proxy' }); });
    api.acquireBrowserProxyLease.mockClear();

    await act(async () => { await result.current.switchTab(firstId); });
    expect(api.acquireBrowserProxyLease).not.toHaveBeenCalled();
  });

  it('releases a stale proxy open when a newer open wins', async () => {
    const pending = [];
    api.acquireBrowserProxyLease.mockImplementation((id, url) => new Promise((resolve) => {
      pending.push({ id, url, resolve });
    }));
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    let oldRequest;
    let newRequest;
    act(() => {
      oldRequest = result.current.openUrl('https://old.example/', { mode: 'proxy' });
      newRequest = result.current.openUrl('https://new.example/', { mode: 'proxy' });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    pending[0].resolve(binding(pending[0].id, pending[0].url));
    await act(async () => {
      await oldRequest;
      await Promise.resolve();
      await Promise.resolve();
    });
    pending[1].resolve(binding(pending[1].id, pending[1].url));
    await act(async () => { await newRequest; });

    expect(result.current.tabs.map((tab) => tab.originalUrl)).toEqual(['https://new.example/']);
    expect(api.deleteBrowserProxyLease).toHaveBeenCalledWith(pending[0].id);
  });

  it('serializes proxy navigation so the latest canonical URL wins', async () => {
    const pending = [];
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await act(async () => { await result.current.openUrl('https://start.example/', { mode: 'proxy' }); });
    const id = result.current.activeId;
    api.navigateBrowserProxyLease.mockImplementation((tabId, url) => new Promise((resolve) => {
      pending.push({ tabId, url, resolve });
    }));

    let first;
    let second;
    act(() => {
      first = result.current.navigateTab(id, 'https://old.example/');
      second = result.current.navigateTab(id, 'https://new.example/');
    });
    await act(async () => { await Promise.resolve(); });
    expect(pending.map((item) => item.url)).toEqual(['https://old.example/']);
    pending[0].resolve(binding(id, pending[0].url));
    await act(async () => { await Promise.resolve(); });
    expect(pending.map((item) => item.url)).toEqual([
      'https://old.example/', 'https://new.example/',
    ]);
    pending[1].resolve(binding(id, pending[1].url));
    await act(async () => { await Promise.all([first, second]); });

    expect(result.current.tabs[0].originalUrl).toBe('https://new.example/');
  });

  it('ignores stale bridge metadata while proxy navigation is pending', async () => {
    let resolveNavigate;
    api.navigateBrowserProxyLease.mockReturnValue(new Promise((resolve) => {
      resolveNavigate = resolve;
    }));
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await act(async () => { await result.current.openUrl('https://old.example/', { mode: 'proxy' }); });
    const id = result.current.activeId;

    let navigating;
    act(() => {
      navigating = result.current.navigateTab(id, 'https://new.example/');
      result.current.updateTabMeta(id, {
        url: 'https://old.example/late', title: 'Stale',
      });
    });
    expect(result.current.tabs[0].originalUrl).toBe('https://new.example/');
    resolveNavigate(binding(id, 'https://new.example/'));
    await act(async () => { await navigating; });
    act(() => result.current.updateTabMeta(id, {
      url: 'https://old.example/after-response', title: 'Still stale',
    }));
    expect(result.current.tabs[0].originalUrl).toBe('https://new.example/');
    expect(result.current.tabs[0].title).toBe('');

    act(() => {
      result.current.markBindingReady(id, `channel-${id}`);
      result.current.updateTabMeta(id, {
        url: 'https://new.example/final', title: 'Current',
      });
    });
    expect(result.current.tabs[0]).toMatchObject({
      originalUrl: 'https://new.example/final', title: 'Current',
    });
  });

  it('disabling releases proxy tabs, closes them locally, and keeps history', async () => {
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await act(async () => { await result.current.openUrl('https://a.example/', { mode: 'proxy' }); });
    const id = result.current.activeId;
    act(() => result.current.closeTab(id));
    expect(readBrowserHistory()).toHaveLength(1);
    await act(async () => { await result.current.openUrl('https://b.example/', { mode: 'proxy' }); });
    const remainingId = result.current.activeId;

    act(() => result.current.setEnabled(false));
    expect(result.current.accessEnabled).toBe(false);
    expect(result.current.tabs).toEqual([]);
    expect(readBrowserHistory()).toHaveLength(1);
    expect(api.deleteBrowserProxyLease).toHaveBeenCalledWith(remainingId);
  });
});
