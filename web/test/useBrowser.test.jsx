import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, renderHook } from '@testing-library/react';

const api = vi.hoisted(() => ({
  createBrowserTab: vi.fn(),
  deleteBrowserTab: vi.fn(),
  getBrowserTabs: vi.fn(),
  navigateBrowserTab: vi.fn(),
  setBrowserTabVisible: vi.fn(),
}));
vi.mock('../src/api.js', () => api);

import { readBrowserHistory } from '../src/browserState.js';
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
  it('deduplicates repeated requests to open the same URL while creation is pending', async () => {
    let release;
    api.createBrowserTab.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useBrowser());
    await flush();

    let first;
    let second;
    act(() => {
      first = result.current.openUrl('https://example.com/login');
      second = result.current.openUrl('https://example.com/login');
    });

    expect(api.createBrowserTab).toHaveBeenCalledOnce();
    release(tab('created'));
    await act(async () => { await Promise.all([first, second]); });
    expect(result.current.tabs).toHaveLength(1);
  });
  it('forwards cancellation when opening a URL', async () => {
    const controller = new AbortController();
    api.createBrowserTab.mockResolvedValue(tab('created'));
    const { result } = renderHook(() => useBrowser());
    await flush();

    await act(async () => { await result.current.openUrl('https://example.com/', { signal: controller.signal }); });

    expect(api.createBrowserTab).toHaveBeenCalledWith('https://example.com/', 10, { signal: controller.signal });
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
    expect(api.createBrowserTab).toHaveBeenCalledWith('http://127.0.0.1:5173/', 10);
    expect(result.current.activeId).toBe('b');
    expect(result.current.open).toBe(true);
    expect(result.current.tabs.find((item) => item.id === 'a').visible).toBe(false);
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
    api.getBrowserTabs.mockResolvedValue({ tabs: [tab('a', { title: '' })] });
    api.deleteBrowserTab.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useBrowser());
    await flush();

    act(() => result.current.updateTabMeta('a', { url: 'https://example.com/a', title: 'Actual page title' }));
    expect(readBrowserHistory()).toEqual([
      expect.objectContaining({ url: 'https://example.com/a', title: 'Actual page title' }),
    ]);
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
