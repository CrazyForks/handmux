import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, renderHook } from '@testing-library/react';

const api = vi.hoisted(() => ({
  clearBrowserProfile: vi.fn(),
  createBrowserTab: vi.fn(),
  deleteBrowserTab: vi.fn(),
  getBrowserTabs: vi.fn(),
  navigateBrowserTab: vi.fn(),
  setBrowserProfilePrefs: vi.fn(),
  setBrowserTabVisible: vi.fn(),
}));
vi.mock('../src/api.js', () => api);

import { readBrowserHistory, upsertBrowserHistory } from '../src/browserState.js';
import { t } from '../src/i18n';
import { useBrowser } from '../src/hooks/useBrowser.js';

const tab = (id, extra = {}) => ({
  id,
  url: `/_browser-${id}/https://example.com/${id}`,
  originalUrl: `https://example.com/${id}`,
  title: `Page ${id}`,
  visible: true,
  expiresAt: null,
  channel: `channel-${id}`,
  ...extra,
});

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('hm_browser_access1', '1');
  vi.clearAllMocks();
  api.getBrowserTabs.mockResolvedValue({ tabs: [] });
  api.setBrowserProfilePrefs.mockResolvedValue({ persist: false, retentionDays: 30, warning: null });
  api.clearBrowserProfile.mockResolvedValue({ closedTabIds: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useBrowser', () => {
  it('requires one explicit device-local consent before starting Browser or loading sessions', async () => {
    localStorage.removeItem('hm_browser_access1');
    const { result } = renderHook(() => useBrowser());
    await flush();
    expect(api.getBrowserTabs).not.toHaveBeenCalled();

    await act(async () => { await result.current.setOpen(true); });
    expect(result.current.consentOpen).toBe(true);
    expect(result.current.open).toBe(false);

    await act(async () => { await result.current.enableAccess(); });
    expect(localStorage.getItem('hm_browser_access1')).toBe('1');
    expect(api.getBrowserTabs).toHaveBeenCalledOnce();
    expect(result.current.open).toBe(true);
    expect(result.current.historyActive).toBe(true);
  });

  it('deduplicates repeated consent confirmation while the first enable request is pending', async () => {
    localStorage.removeItem('hm_browser_access1');
    let release;
    api.getBrowserTabs.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    api.createBrowserTab.mockResolvedValue(tab('created'));
    const { result } = renderHook(() => useBrowser());
    await flush();

    await act(async () => { await result.current.openUrl('https://example.com/'); });
    let first;
    let second;
    act(() => {
      first = result.current.enableAccess();
      second = result.current.enableAccess();
    });

    expect(api.getBrowserTabs).toHaveBeenCalledOnce();
    release({ tabs: [] });
    await act(async () => { await Promise.all([first, second]); });
    expect(api.createBrowserTab).toHaveBeenCalledOnce();
  });
  it('cancels the pending open request and commits only the latest URL', async () => {
    const requests = [];
    api.createBrowserTab.mockImplementation((url, _closeAfter, _mode, { signal } = {}) => new Promise((resolve) => {
      requests.push({ url, signal, resolve });
    }));
    const { result } = renderHook(() => useBrowser());
    await flush();

    let first;
    let second;
    act(() => {
      first = result.current.openUrl('https://example.com/first');
      second = result.current.openUrl('https://example.com/latest');
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].signal.aborted).toBe(false);

    requests[1].resolve(tab('latest'));
    await act(async () => { await second; });
    requests[0].resolve(tab('stale'));
    let staleResult;
    await act(async () => { staleResult = await first; });

    expect(staleResult).toBeNull();
    expect(result.current.tabs.map((item) => item.id)).toEqual(['latest']);
    expect(api.deleteBrowserTab).toHaveBeenCalledWith('stale');
  });
  it('links external cancellation into the take-latest request signal', async () => {
    const controller = new AbortController();
    let requestSignal;
    api.createBrowserTab.mockImplementation((_url, _closeAfter, _mode, { signal }) => {
      requestSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const { result } = renderHook(() => useBrowser());
    await flush();

    let opening;
    act(() => { opening = result.current.openUrl('https://example.com/', { signal: controller.signal }); });
    expect(requestSignal).not.toBe(controller.signal);
    expect(requestSignal.aborted).toBe(false);
    controller.abort();
    let opened;
    await act(async () => { opened = await opening; });

    expect(requestSignal.aborted).toBe(true);
    expect(opened).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('restores the previously visible tab when the replacing open fails', async () => {
    const requests = [];
    api.getBrowserTabs.mockResolvedValue({ tabs: [tab('a')] });
    api.createBrowserTab.mockImplementation((_url, _closeAfter, _mode, { signal }) => new Promise((resolve, reject) => {
      requests.push({ resolve, reject, signal });
    }));
    api.deleteBrowserTab.mockResolvedValue({ ok: true });
    api.setBrowserTabVisible.mockResolvedValue(tab('a'));
    const { result } = renderHook(() => useBrowser());
    await flush();

    let stale;
    let latest;
    act(() => {
      stale = result.current.openUrl('https://example.com/stale');
      latest = result.current.openUrl('https://example.com/latest');
    });
    requests[0].resolve(tab('stale'));
    await act(async () => { await stale; });
    requests[1].reject(new Error('latest failed'));
    await act(async () => { await latest; });

    expect(api.deleteBrowserTab).toHaveBeenCalledWith('stale');
    expect(api.setBrowserTabVisible).toHaveBeenCalledWith('a', true, 10);
    expect(result.current.tabs).toEqual([expect.objectContaining({ id: 'a', visible: true })]);
    expect(result.current.open).toBe(true);
  });
  it('waits for Handmux authentication before loading server tabs', async () => {
    const { rerender } = renderHook(
      ({ enabled }) => useBrowser({ enabled }),
      { initialProps: { enabled: false } },
    );
    await flush();
    expect(api.getBrowserTabs).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await flush();
    expect(api.getBrowserTabs).toHaveBeenCalledOnce();
  });

  it('normalizes server-loaded legacy tabs to proxy before navigate, metadata, close, and history flows', async () => {
    api.getBrowserTabs.mockResolvedValue({ tabs: [tab('legacy')] });
    api.navigateBrowserTab.mockResolvedValue(tab('legacy', { title: '' }));
    api.deleteBrowserTab.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();

    expect(result.current.tabs[0].mode).toBe('proxy');
    await act(async () => {
      await result.current.navigateTab('legacy', 'https://example.com/legacy');
    });
    expect(api.navigateBrowserTab).toHaveBeenCalledWith(
      'legacy', 'https://example.com/legacy', 'proxy',
    );

    act(() => result.current.updateTabMeta('legacy', {
      url: 'https://example.com/legacy', title: 'Legacy title',
    }));
    await act(async () => { await result.current.closeTab('legacy'); });
    expect(readBrowserHistory()[0]).toMatchObject({
      url: 'https://example.com/legacy', title: 'Legacy title', lastMode: 'proxy',
    });
  });

  it('shows the selected tab atomically and mirrors the displaced tab locally', async () => {
    const a = tab('a');
    const b = tab('b', { visible: false, expiresAt: Date.now() + 600_000 });
    api.getBrowserTabs.mockResolvedValue({ tabs: [a, b] });
    const order = [];
    api.setBrowserTabVisible.mockImplementation(async (id, visible) => {
      order.push(`${id}:${visible}`);
      return tab(id, { visible, expiresAt: visible ? null : Date.now() + 600_000 });
    });
    const { result } = renderHook(() => useBrowser());
    await flush();

    await act(async () => { await result.current.switchTab('b'); });

    expect(order).toEqual(['b:true']);
    expect(result.current.activeId).toBe('b');
    expect(result.current.historyActive).toBe(false);
    expect(result.current.tabs.find((item) => item.id === 'a').visible).toBe(false);
  });

  it('keeps the current tab visible when showing the selected tab fails', async () => {
    const a = tab('a');
    const b = tab('b', { visible: false, expiresAt: Date.now() + 600_000 });
    api.getBrowserTabs.mockResolvedValue({ tabs: [a, b] });
    api.setBrowserTabVisible.mockRejectedValue(new Error('show failed'));
    const { result } = renderHook(() => useBrowser());
    await flush();

    let switched;
    await act(async () => { switched = await result.current.switchTab('b'); });

    expect(switched).toBe(false);
    expect(api.setBrowserTabVisible.mock.calls).toEqual([['b', true, 10]]);
    expect(result.current.activeId).toBe('a');
    expect(result.current.tabs.find((item) => item.id === 'a').visible).toBe(true);
  });

  it('serializes rapid tab switches so the last click remains active', async () => {
    const a = tab('a');
    const b = tab('b', { visible: false, expiresAt: Date.now() + 600_000 });
    api.getBrowserTabs.mockResolvedValue({ tabs: [a, b] });
    const releases = [];
    api.setBrowserTabVisible.mockImplementation((id, visible) => new Promise((resolve) => {
      releases.push(() => resolve(tab(id, { visible, expiresAt: visible ? null : Date.now() + 600_000 })));
    }));
    const { result } = renderHook(() => useBrowser());
    await flush();

    let selectB;
    let selectA;
    act(() => {
      selectB = result.current.switchTab('b');
      selectA = result.current.switchTab('a');
    });
    await flush();
    expect(api.setBrowserTabVisible.mock.calls).toEqual([['b', true, 10]]);

    await act(async () => { releases.shift()(); await Promise.resolve(); });
    expect(api.setBrowserTabVisible.mock.calls).toEqual([
      ['b', true, 10], ['a', true, 10],
    ]);
    await act(async () => { releases.shift()(); await Promise.all([selectB, selectA]); });

    expect(result.current.activeId).toBe('a');
    expect(result.current.tabs.find((item) => item.id === 'a').visible).toBe(true);
    expect(result.current.tabs.find((item) => item.id === 'b').visible).toBe(false);
  });

  it('hides the newly selected tab when minimized during a pending switch', async () => {
    const a = tab('a');
    const b = tab('b', { visible: false, expiresAt: Date.now() + 600_000 });
    api.getBrowserTabs.mockResolvedValue({ tabs: [a, b] });
    const releases = [];
    api.setBrowserTabVisible.mockImplementation((id, visible) => new Promise((resolve) => {
      releases.push(() => resolve(tab(id, { visible, expiresAt: visible ? null : Date.now() + 600_000 })));
    }));
    const { result } = renderHook(() => useBrowser());
    await flush();

    let selecting;
    let minimizing;
    act(() => {
      selecting = result.current.switchTab('b');
      minimizing = result.current.setOpen(false);
    });
    await flush();
    expect(api.setBrowserTabVisible.mock.calls).toEqual([['b', true, 10]]);

    await act(async () => { releases.shift()(); await Promise.resolve(); });
    expect(api.setBrowserTabVisible.mock.calls).toEqual([['b', true, 10], ['b', false, 10]]);
    await act(async () => { releases.shift()(); await Promise.all([selecting, minimizing]); });

    expect(result.current.activeId).toBe('b');
    expect(result.current.open).toBe(false);
    expect(result.current.tabs.find((item) => item.id === 'b').visible).toBe(false);
  });

  it('starts the active tab timer when minimized and cancels it when reopened', async () => {
    const a = tab('a');
    api.getBrowserTabs.mockResolvedValue({ tabs: [a] });
    api.setBrowserTabVisible
      .mockResolvedValueOnce(tab('a', { visible: false, expiresAt: Date.now() + 600_000 }))
      .mockResolvedValueOnce(tab('a', { visible: true, expiresAt: null }));
    const { result } = renderHook(() => useBrowser());
    await flush();

    await act(async () => { await result.current.setOpen(false); });
    await act(async () => { await result.current.setOpen(true); });

    expect(api.setBrowserTabVisible.mock.calls).toEqual([
      ['a', false, 10],
      ['a', true, 10],
    ]);
    expect(result.current.open).toBe(true);
    expect(result.current.tabs[0].expiresAt).toBeNull();
  });

  it('resynchronizes lost worker tabs and still minimizes locally after a restart', async () => {
    api.getBrowserTabs
      .mockResolvedValueOnce({ tabs: [tab('a')] })
      .mockResolvedValueOnce({ tabs: [] });
    api.setBrowserTabVisible.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
    const { result } = renderHook(() => useBrowser());
    await flush();

    let minimized;
    await act(async () => { minimized = await result.current.setOpen(false); });

    expect(minimized).toBe(true);
    expect(result.current.open).toBe(false);
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeId).toBeNull();
    expect(result.current.historyActive).toBe(true);
    expect(api.getBrowserTabs).toHaveBeenCalledTimes(2);
  });

  it('opens a normalized URL atomically and mirrors the old tab as hidden', async () => {
    const a = tab('a');
    const b = tab('b', { originalUrl: 'http://127.0.0.1:5173/' });
    api.getBrowserTabs.mockResolvedValue({ tabs: [a] });
    api.setBrowserTabVisible.mockResolvedValue(tab('a', { visible: false, expiresAt: Date.now() + 600_000 }));
    api.createBrowserTab.mockResolvedValue(b);
    const { result } = renderHook(() => useBrowser());
    await flush();

    await act(async () => { await result.current.openUrl('5173'); });

    expect(api.setBrowserTabVisible).not.toHaveBeenCalled();
    expect(api.createBrowserTab).toHaveBeenCalledWith(
      'http://127.0.0.1:5173/', 10, 'direct', { signal: expect.any(AbortSignal) },
    );
    expect(result.current.activeId).toBe('b');
    expect(result.current.open).toBe(true);
    expect(result.current.tabs.find((item) => item.id === 'a').visible).toBe(false);
  });

  it('uses the device default mode and exposes mode preferences', async () => {
    localStorage.setItem('hm_browser_default_mode1', 'proxy');
    api.createBrowserTab.mockResolvedValue(tab('proxy', { mode: 'proxy' }));
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();

    await act(async () => { await result.current.openUrl('https://example.com/'); });

    expect(api.createBrowserTab).toHaveBeenCalledWith(
      'https://example.com/', 10, 'proxy', { signal: expect.any(AbortSignal) },
    );
    expect(result.current.defaultMode).toBe('proxy');
    expect(result.current.proxyAvailable).toBe(true);

    act(() => { result.current.setDefaultMode('direct'); });
    expect(result.current.defaultMode).toBe('direct');
  });

  it('updates a history mode in storage and hook state even when opening it fails', async () => {
    const entry = { url: 'https://old.example/', title: 'Old', visitedAt: 1000, lastMode: 'direct' };
    upsertBrowserHistory(entry);
    api.createBrowserTab.mockRejectedValue(new Error('open failed'));
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();

    act(() => { result.current.setHistoryMode(entry, 'proxy'); });
    expect(result.current.history[0].lastMode).toBe('proxy');
    expect(readBrowserHistory()[0].lastMode).toBe('proxy');

    await act(async () => {
      await result.current.openUrl(entry.url, { mode: result.current.history[0].lastMode });
    });
    expect(result.current.history[0].lastMode).toBe('proxy');
    expect(readBrowserHistory()[0].lastMode).toBe('proxy');
  });

  it('rejects unavailable proxy actions locally without falling back to direct', async () => {
    const { result } = renderHook(() => useBrowser({ browserProxy: false }));
    await flush();

    let opened;
    await act(async () => { opened = await result.current.openUrl('https://example.com/', { mode: 'proxy' }); });

    expect(opened).toBeNull();
    expect(api.createBrowserTab).not.toHaveBeenCalled();
    expect(result.current.error?.message).toBe('browser proxy unavailable');
  });

  it('rechecks proxy availability before opening a consent-pending URL', async () => {
    localStorage.removeItem('hm_browser_access1');
    let releaseLoad;
    api.getBrowserTabs.mockReturnValue(new Promise((resolve) => { releaseLoad = resolve; }));
    api.createBrowserTab.mockResolvedValue(tab('proxy', { mode: 'proxy' }));
    const { result, rerender } = renderHook(
      ({ browserProxy }) => useBrowser({ browserProxy }),
      { initialProps: { browserProxy: true } },
    );
    await flush();

    await act(async () => {
      await result.current.openUrl('https://example.com/', { mode: 'proxy' });
    });
    let enabling;
    act(() => { enabling = result.current.enableAccess(); });
    await flush();
    rerender({ browserProxy: false });
    releaseLoad({ tabs: [] });
    await act(async () => { await enabling; });

    expect(api.createBrowserTab).not.toHaveBeenCalled();
    expect(result.current.error?.message).toBe('browser proxy unavailable');
  });

  it('does not let a consent-pending URL overwrite a newer open request', async () => {
    localStorage.removeItem('hm_browser_access1');
    let releaseLoad;
    api.getBrowserTabs.mockReturnValue(new Promise((resolve) => { releaseLoad = resolve; }));
    api.createBrowserTab.mockImplementation(async (url) => (
      url.endsWith('/a') ? tab('a', { originalUrl: url }) : tab('b', { originalUrl: url })
    ));
    const { result } = renderHook(() => useBrowser());
    await flush();

    await act(async () => { await result.current.openUrl('https://example.com/a'); });
    let enabling;
    act(() => { enabling = result.current.enableAccess(); });
    await flush();

    await act(async () => { await result.current.openUrl('https://example.com/b'); });
    releaseLoad({ tabs: [] });
    await act(async () => { await enabling; });

    expect(api.createBrowserTab.mock.calls.map(([url]) => url)).toEqual(['https://example.com/b']);
    expect(result.current.activeId).toBe('b');
    expect(result.current.tabs.map(({ id }) => id)).toEqual(['b']);
  });

  it('threads mode through navigation and records the successful mode', async () => {
    api.getBrowserTabs.mockResolvedValue({ tabs: [tab('a', { mode: 'direct' })] });
    api.navigateBrowserTab.mockResolvedValue(tab('a', { mode: 'proxy' }));
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();

    await act(async () => { await result.current.navigateTab('a', 'https://example.com/a', 'proxy'); });

    expect(api.navigateBrowserTab).toHaveBeenCalledWith('a', 'https://example.com/a', 'proxy');
    expect(readBrowserHistory()[0]).toMatchObject({
      url: 'https://example.com/a', lastMode: 'proxy',
    });
  });

  it('serializes same-tab navigation so the server and client both finish in the latest mode', async () => {
    api.getBrowserTabs.mockResolvedValue({ tabs: [tab('a', { mode: 'direct' })] });
    let serverMode = 'direct';
    const requests = [];
    api.navigateBrowserTab.mockImplementation((_id, _url, mode) => new Promise((resolve) => {
      requests.push({
        mode,
        settle: () => {
          serverMode = mode;
          resolve(tab('a', { mode }));
        },
      });
    }));
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();

    let older;
    let latest;
    act(() => {
      older = result.current.navigateTab('a', 'https://example.com/a', 'proxy');
      latest = result.current.navigateTab('a', 'https://example.com/a', 'direct');
    });
    await flush();
    expect(requests).toHaveLength(1);

    requests[0].settle();
    await flush();
    expect(requests).toHaveLength(2);
    expect(result.current.tabs[0].mode).toBe('direct');

    requests[1].settle();
    await act(async () => { await Promise.all([older, latest]); });

    expect(serverMode).toBe('direct');
    expect(result.current.tabs[0].mode).toBe('direct');
  });

  it('does not let invalid URL rejection cancel an in-flight valid navigation', async () => {
    api.getBrowserTabs.mockResolvedValue({ tabs: [tab('a', { mode: 'direct' })] });
    let settle;
    api.navigateBrowserTab.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();

    let valid;
    act(() => { valid = result.current.navigateTab('a', 'https://example.com/a', 'proxy'); });
    await act(async () => {
      await result.current.navigateTab('a', 'javascript:alert(1)', 'direct');
    });
    settle(tab('a', { mode: 'proxy' }));
    await act(async () => { await valid; });

    expect(api.navigateBrowserTab).toHaveBeenCalledOnce();
    expect(result.current.tabs[0].mode).toBe('proxy');
  });

  it('does not let unavailable proxy rejection cancel an in-flight valid navigation', async () => {
    api.getBrowserTabs.mockResolvedValue({ tabs: [tab('a', { mode: 'proxy' })] });
    let settle;
    api.navigateBrowserTab.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    const { result } = renderHook(() => useBrowser({ browserProxy: false }));
    await flush();

    let valid;
    act(() => { valid = result.current.navigateTab('a', 'https://example.com/a', 'direct'); });
    await act(async () => {
      await result.current.navigateTab('a', 'https://example.com/a', 'proxy');
    });
    settle(tab('a', { mode: 'direct' }));
    await act(async () => { await valid; });

    expect(api.navigateBrowserTab).toHaveBeenCalledOnce();
    expect(result.current.tabs[0].mode).toBe('direct');
  });

  it('does not let an older failed navigation resync over the latest mode change', async () => {
    let releaseResync;
    api.getBrowserTabs
      .mockResolvedValueOnce({ tabs: [tab('a', { mode: 'direct' })] })
      .mockReturnValueOnce(new Promise((resolve) => { releaseResync = resolve; }));
    const requests = [];
    api.navigateBrowserTab.mockImplementation((_id, _url, mode) => new Promise((resolve, reject) => {
      requests.push({ mode, resolve, reject });
    }));
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();

    let older;
    act(() => { older = result.current.navigateTab('a', 'https://example.com/a', 'proxy'); });
    await flush();
    requests[0].reject(Object.assign(new Error('missing'), { status: 404 }));
    await flush();
    expect(api.getBrowserTabs).toHaveBeenCalledTimes(2);

    let latest;
    act(() => { latest = result.current.navigateTab('a', 'https://example.com/a', 'direct'); });
    await flush();
    requests[1].resolve(tab('a', { mode: 'direct' }));
    await act(async () => { await latest; });
    releaseResync({ tabs: [tab('a', { mode: 'proxy' })] });
    await act(async () => { await older; });

    expect(api.getBrowserTabs).toHaveBeenCalledTimes(2);
    expect(result.current.tabs[0].mode).toBe('direct');
    expect(result.current.error).toBeNull();
  });

  it('does not let tab A resync overwrite a later successful tab B visibility mutation', async () => {
    const a = tab('a', { mode: 'direct' });
    const b = tab('b', { mode: 'direct', visible: false, expiresAt: Date.now() + 600_000 });
    let releaseResync;
    api.getBrowserTabs
      .mockResolvedValueOnce({ tabs: [a, b] })
      .mockReturnValueOnce(new Promise((resolve) => { releaseResync = resolve; }));
    api.navigateBrowserTab.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
    api.setBrowserTabVisible.mockResolvedValue(tab('b', { mode: 'direct' }));
    const { result } = renderHook(() => useBrowser());
    await flush();

    let navigating;
    act(() => { navigating = result.current.navigateTab('a', 'https://example.com/a', 'direct'); });
    await flush();
    expect(api.getBrowserTabs).toHaveBeenCalledTimes(2);

    await act(async () => { await result.current.switchTab('b'); });
    expect(result.current.activeId).toBe('b');
    releaseResync({ tabs: [a, b] });
    await act(async () => { await navigating; });

    expect(result.current.activeId).toBe('b');
    expect(result.current.tabs.find(({ id }) => id === 'b').visible).toBe(true);
  });

  it('treats a concurrent same-generation resync as recovered after its peer commits', async () => {
    const a = tab('a', { mode: 'direct' });
    const b = tab('b', { mode: 'direct', visible: false, expiresAt: Date.now() + 600_000 });
    const requests = [];
    const resyncs = [];
    api.getBrowserTabs
      .mockResolvedValueOnce({ tabs: [a, b] })
      .mockImplementation(() => new Promise((resolve) => { resyncs.push(resolve); }));
    api.navigateBrowserTab.mockImplementation((_id, _url, _mode) => new Promise((_resolve, reject) => {
      requests.push({ reject });
    }));
    const { result } = renderHook(() => useBrowser());
    await flush();

    let navigatingA;
    let navigatingB;
    act(() => {
      navigatingA = result.current.navigateTab('a', 'https://example.com/a', 'direct');
      navigatingB = result.current.navigateTab('b', 'https://example.com/b', 'direct');
    });
    await flush();
    requests[0].reject(Object.assign(new Error('missing a'), { status: 404 }));
    requests[1].reject(Object.assign(new Error('missing b'), { status: 404 }));
    await flush();
    expect(resyncs).toHaveLength(2);

    resyncs[0]({ tabs: [a, b] });
    await flush();
    resyncs[1]({ tabs: [a, b] });
    await act(async () => { await Promise.all([navigatingA, navigatingB]); });

    expect(result.current.error).toBeNull();
    expect(result.current.tabs.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('invalidates a newer resync when an earlier-started visibility mutation commits later', async () => {
    const a = tab('a', { mode: 'direct' });
    const b = tab('b', { mode: 'direct', visible: false, expiresAt: Date.now() + 600_000 });
    let releaseVisibility;
    let releaseResync;
    api.getBrowserTabs
      .mockResolvedValueOnce({ tabs: [a, b] })
      .mockReturnValueOnce(new Promise((resolve) => { releaseResync = resolve; }));
    api.setBrowserTabVisible.mockReturnValue(new Promise((resolve) => { releaseVisibility = resolve; }));
    api.navigateBrowserTab.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
    const { result } = renderHook(() => useBrowser());
    await flush();

    let switching;
    act(() => { switching = result.current.switchTab('b'); });
    await flush();
    expect(api.setBrowserTabVisible).toHaveBeenCalledOnce();

    let navigating;
    act(() => { navigating = result.current.navigateTab('a', 'https://example.com/a', 'direct'); });
    await flush();
    expect(api.getBrowserTabs).toHaveBeenCalledTimes(2);

    releaseVisibility(tab('b', { mode: 'direct' }));
    await act(async () => { await switching; });
    releaseResync({ tabs: [a, b] });
    await act(async () => { await navigating; });

    expect(result.current.activeId).toBe('b');
    expect(result.current.tabs.find(({ id }) => id === 'b').visible).toBe(true);
    expect(result.current.error?.message).toBe('missing');
  });

  it('invalidates a newer resync when an earlier-started open create commits later', async () => {
    const a = tab('a', { mode: 'direct' });
    let releaseCreate;
    let releaseResync;
    api.getBrowserTabs
      .mockResolvedValueOnce({ tabs: [a] })
      .mockReturnValueOnce(new Promise((resolve) => { releaseResync = resolve; }));
    api.createBrowserTab.mockReturnValue(new Promise((resolve) => { releaseCreate = resolve; }));
    api.navigateBrowserTab.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
    const { result } = renderHook(() => useBrowser());
    await flush();

    let opening;
    act(() => { opening = result.current.openUrl('https://example.com/b', { mode: 'direct' }); });
    await flush();
    expect(api.createBrowserTab).toHaveBeenCalledOnce();

    let navigating;
    act(() => { navigating = result.current.navigateTab('a', 'https://example.com/a', 'direct'); });
    await flush();
    expect(api.getBrowserTabs).toHaveBeenCalledTimes(2);

    releaseCreate(tab('b', { mode: 'direct' }));
    await act(async () => { await opening; });
    releaseResync({ tabs: [a] });
    await act(async () => { await navigating; });

    expect(result.current.activeId).toBe('b');
    expect(result.current.tabs.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(result.current.error?.message).toBe('missing');
  });

  it('awaits a fresh device profile synchronization before every proxy open', async () => {
    let releaseSync;
    let releaseRestartSync;
    api.setBrowserProfilePrefs.mockReturnValue(new Promise((resolve) => { releaseSync = resolve; }));
    api.createBrowserTab.mockResolvedValue(tab('proxy', { mode: 'proxy' }));
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();

    let opening;
    act(() => { opening = result.current.openUrl('https://example.com/', { mode: 'proxy' }); });
    await flush();
    expect(api.setBrowserProfilePrefs).toHaveBeenCalledWith({ persist: false, retentionDays: 30 });
    expect(api.createBrowserTab).not.toHaveBeenCalled();

    releaseSync({ persist: false, retentionDays: 30, warning: null });
    await act(async () => { await opening; });
    expect(api.createBrowserTab).toHaveBeenCalledOnce();

    api.setBrowserProfilePrefs.mockReturnValue(
      new Promise((resolve) => { releaseRestartSync = resolve; }),
    );
    let afterRestart;
    act(() => {
      afterRestart = result.current.openUrl('https://example.com/after-restart', { mode: 'proxy' });
    });
    await flush();
    expect(api.setBrowserProfilePrefs).toHaveBeenCalledTimes(2);
    expect(api.createBrowserTab).toHaveBeenCalledOnce();
    releaseRestartSync({ persist: false, retentionDays: 30, warning: null });
    await act(async () => { await afterRestart; });
    expect(api.createBrowserTab).toHaveBeenCalledTimes(2);
  });

  it('blocks only proxy when initial profile sync fails and keeps direct usable', async () => {
    api.setBrowserProfilePrefs.mockRejectedValue(new Error('worker unavailable'));
    api.createBrowserTab.mockResolvedValue(tab('direct', { mode: 'direct' }));
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();

    let proxied;
    await act(async () => {
      proxied = await result.current.openUrl('https://proxy.example/', { mode: 'proxy' });
    });
    expect(proxied).toBeNull();
    expect(result.current.error?.message).toBe(t('browser.profileSyncFailed'));

    let direct;
    await act(async () => {
      direct = await result.current.openUrl('https://direct.example/', { mode: 'direct' });
    });
    expect(direct?.mode).toBe('direct');

    api.setBrowserProfilePrefs.mockResolvedValueOnce({
      persist: false, retentionDays: 30, warning: null,
    });
    api.createBrowserTab.mockResolvedValue(tab('proxy-retry', { mode: 'proxy' }));
    let retried;
    await act(async () => {
      retried = await result.current.openUrl('https://proxy.example/retry', { mode: 'proxy' });
    });
    expect(retried?.mode).toBe('proxy');
  });

  it('stores profile preferences only after the matching server update succeeds', async () => {
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();
    api.setBrowserProfilePrefs.mockRejectedValueOnce(new Error('save failed'));

    await act(async () => { await result.current.setPersistProxyLogin(true); });
    expect(localStorage.getItem('hm_browser_profile_persist1')).toBeNull();
    expect(result.current.persistProxyLogin).toBe(false);
    expect(result.current.error?.message).toBe(t('browser.profileSaveFailed'));

    api.setBrowserProfilePrefs.mockResolvedValueOnce({ persist: false, retentionDays: 7, warning: null });
    await act(async () => { await result.current.setProxyLoginRetentionDays(7); });
    expect(result.current.proxyLoginRetentionDays).toBe(7);
    expect(localStorage.getItem('hm_browser_profile_retention1')).toBe('7');
  });

  it('shows profile recovery warning once without clearing it during the matching save', async () => {
    api.setBrowserProfilePrefs.mockResolvedValue({
      persist: false, retentionDays: 30, warning: 'profile-recovery-failed',
    });
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();
    expect(result.current.error?.message).toBe(t('browser.profileRecoveryWarning'));

    api.setBrowserProfilePrefs.mockResolvedValueOnce({
      persist: false, retentionDays: 7, warning: 'profile-recovery-failed',
    });
    await act(async () => { await result.current.setProxyLoginRetentionDays(7); });
    expect(result.current.error?.message).toBe(t('browser.profileRecoveryWarning'));
  });

  it('removes only server-confirmed proxy tabs and falls back to a remaining tab', async () => {
    api.getBrowserTabs.mockResolvedValue({
      tabs: [tab('proxy', { mode: 'proxy' }), tab('direct', { mode: 'direct', visible: false })],
    });
    api.clearBrowserProfile.mockResolvedValue({ closedTabIds: ['proxy'] });
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();

    await act(async () => { await result.current.clearProxyLogin('https://example.com'); });

    expect(result.current.tabs.map((item) => item.id)).toEqual(['direct']);
    expect(result.current.activeId).toBeNull();
    expect(result.current.historyActive).toBe(true);
  });

  it('resyncs server truth after a partially failed clear instead of keeping ghost tabs', async () => {
    api.getBrowserTabs
      .mockResolvedValueOnce({ tabs: [tab('proxy', { mode: 'proxy' }), tab('direct', { mode: 'direct' })] })
      .mockResolvedValueOnce({ tabs: [tab('direct', { mode: 'direct' })] });
    api.clearBrowserProfile.mockRejectedValue(new Error('profile disk unavailable'));
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();

    await act(async () => { await result.current.clearProxyLogin(null); });

    expect(api.getBrowserTabs).toHaveBeenCalledTimes(2);
    expect(result.current.tabs.map((item) => item.id)).toEqual(['direct']);
    expect(result.current.error?.message).toBe(t('browser.profileClearFailed'));
  });

  it('deletes one history row locally without clearing its Cookie profile', async () => {
    const entry = { url: 'https://old.example/', title: 'Old', visitedAt: 1000, lastMode: 'proxy' };
    upsertBrowserHistory(entry);
    const { result } = renderHook(() => useBrowser({ browserProxy: true }));
    await flush();

    act(() => { result.current.deleteHistory(entry); });

    expect(result.current.history).toEqual([]);
    expect(api.clearBrowserProfile).not.toHaveBeenCalled();
  });

  it('moves each independently expired background tab into device history', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    api.getBrowserTabs.mockResolvedValue({
      tabs: [
        tab('a'),
        tab('b', { visible: false, expiresAt: 2_000 }),
        tab('c', { visible: false, expiresAt: 3_000 }),
      ],
    });
    const { result } = renderHook(() => useBrowser());
    await flush();

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(result.current.tabs.map((item) => item.id)).toEqual(['a', 'c']);
    expect(readBrowserHistory().map((item) => item.url)).toEqual(['https://example.com/b']);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(result.current.tabs.map((item) => item.id)).toEqual(['a']);
    expect(readBrowserHistory().map((item) => item.url)).toEqual([
      'https://example.com/c',
      'https://example.com/b',
    ]);
  });

  it('keeps the fixed history view independent of tmux context', async () => {
    const a = tab('a');
    api.getBrowserTabs.mockResolvedValue({ tabs: [a] });
    api.setBrowserTabVisible.mockResolvedValue(tab('a', { visible: false, expiresAt: Date.now() + 600_000 }));
    const { result, rerender } = renderHook(({ tmuxWindow }) => {
      void tmuxWindow;
      return useBrowser();
    }, { initialProps: { tmuxWindow: '@1' } });
    await flush();

    await act(async () => { await result.current.switchTab('history'); });
    rerender({ tmuxWindow: '@2' });

    expect(result.current.historyActive).toBe(true);
    expect(result.current.tabs).toHaveLength(1);
    expect(api.getBrowserTabs).toHaveBeenCalledTimes(1);
  });

  it('shows the next tab immediately when the active visible tab is closed', async () => {
    const a = tab('a');
    const b = tab('b', { visible: false, expiresAt: Date.now() + 600_000 });
    api.getBrowserTabs.mockResolvedValue({ tabs: [a, b] });
    api.deleteBrowserTab.mockResolvedValue({ ok: true });
    api.setBrowserTabVisible.mockResolvedValue(tab('b'));
    const { result } = renderHook(() => useBrowser());
    await flush();

    await act(async () => { await result.current.closeTab('a'); });

    expect(api.setBrowserTabVisible).toHaveBeenCalledWith('b', true, 10);
    expect(result.current.activeId).toBe('b');
    expect(result.current.tabs).toEqual([expect.objectContaining({ id: 'b', visible: true, expiresAt: null })]);
  });

  it('uses the latest page title when moving a tab into history', async () => {
    api.getBrowserTabs.mockResolvedValue({ tabs: [tab('a', { title: '', mode: 'proxy' })] });
    api.deleteBrowserTab.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useBrowser());
    await flush();

    act(() => result.current.updateTabMeta('a', { url: 'https://example.com/a', title: 'Actual page title' }));
    expect(readBrowserHistory()).toEqual([expect.objectContaining({
      url: 'https://example.com/a', title: 'Actual page title', lastMode: 'proxy',
    })]);
    await act(async () => { await result.current.closeTab('a'); });

    expect(readBrowserHistory()[0]).toMatchObject({ url: 'https://example.com/a', title: 'Actual page title' });
    expect(readBrowserHistory()).toHaveLength(1);
  });

  it('does not rewrite or restore history when page metadata has not changed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    api.getBrowserTabs.mockResolvedValue({ tabs: [tab('a', { title: '' })] });
    const { result } = renderHook(() => useBrowser());
    await flush();

    act(() => result.current.updateTabMeta('a', { url: 'https://example.com/a', title: 'Actual title' }));
    expect(readBrowserHistory()[0].visitedAt).toBe(1_000);

    vi.setSystemTime(2_000);
    act(() => result.current.updateTabMeta('a', { url: 'https://example.com/a', title: 'Actual title' }));
    expect(readBrowserHistory()[0].visitedAt).toBe(1_000);

    act(() => result.current.clearHistory());
    act(() => result.current.updateTabMeta('a', { url: 'https://example.com/a', title: 'Actual title' }));
    expect(readBrowserHistory()).toEqual([]);
  });
});
