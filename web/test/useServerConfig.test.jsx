import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook, cleanup } from '@testing-library/react';

const api = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock('../src/api.js', () => ({ getConfig: api.getConfig }));

import { useServerConfig } from '../src/hooks/useServerConfig.js';

afterEach(() => { cleanup(); vi.useRealTimers(); api.getConfig.mockReset(); });

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe('useServerConfig', () => {
  it('fetches once per app launch without polling or foreground refreshes', async () => {
    vi.useFakeTimers();
    const first = { command: [], chat: [{ type: 'text', text: 'old', enter: true }] };
    const second = { command: [], chat: [{ type: 'text', text: 'new', enter: true }] };
    const config = { shortcuts: first, asr: true, claudeHooks: 'absent' };
    api.getConfig.mockResolvedValueOnce(config).mockResolvedValue({ shortcuts: second });
    const { result } = renderHook(() => useServerConfig());
    await flush();
    expect(result.current).toEqual(config);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(api.getConfig).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual(config);
  });

  it('waits for authentication before making its one request', async () => {
    const config = { shortcuts: { command: [], chat: [] }, asr: false, claudeHooks: 'installed' };
    api.getConfig.mockResolvedValue(config);
    const { result, rerender } = renderHook(
      ({ enabled }) => useServerConfig({ enabled }),
      { initialProps: { enabled: false } },
    );
    await flush();
    expect(api.getConfig).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await flush();
    expect(api.getConfig).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual(config);
    rerender({ enabled: false });
    rerender({ enabled: true });
    await flush();
    expect(api.getConfig).toHaveBeenCalledTimes(1);
  });

  it('keeps startup defaults and never retries after its only request fails', async () => {
    api.getConfig.mockRejectedValue(new Error('offline'));
    const { result, rerender } = renderHook(
      ({ enabled }) => useServerConfig({ enabled }),
      { initialProps: { enabled: true } },
    );
    await flush();
    rerender({ enabled: false });
    rerender({ enabled: true });
    await flush();
    expect(api.getConfig).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();
  });
});
