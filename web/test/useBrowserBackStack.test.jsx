import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { useBrowserBackStack } from '../src/hooks/useBrowserBackStack.js';

const pop = () => act(() => window.dispatchEvent(new PopStateEvent('popstate')));

beforeEach(() => {
  vi.spyOn(window.history, 'pushState');
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
  vi.spyOn(window.history, 'go').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useBrowserBackStack', () => {
  it('returns from a page opened from History before closing Browser', () => {
    const switchTab = vi.fn();
    const setOpen = vi.fn();
    const { rerender } = renderHook(
      ({ open, historyActive }) => useBrowserBackStack({
        open, historyActive, switchTab, setOpen,
      }),
      { initialProps: { open: true, historyActive: true } },
    );
    expect(window.history.pushState).toHaveBeenCalledTimes(1);

    rerender({ open: true, historyActive: false });
    expect(window.history.pushState).toHaveBeenCalledTimes(2);

    pop();
    expect(switchTab).toHaveBeenCalledWith('history');
    expect(setOpen).not.toHaveBeenCalled();

    rerender({ open: true, historyActive: true });
    pop();
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('consumes the page layer when History is selected on screen', () => {
    const switchTab = vi.fn();
    const setOpen = vi.fn();
    const { rerender } = renderHook(
      ({ historyActive }) => useBrowserBackStack({
        open: true, historyActive, switchTab, setOpen,
      }),
      { initialProps: { historyActive: true } },
    );
    rerender({ historyActive: false });
    rerender({ historyActive: true });

    expect(window.history.back).toHaveBeenCalledOnce();
    pop();
    expect(switchTab).not.toHaveBeenCalled();
    expect(setOpen).not.toHaveBeenCalled();

    pop();
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('closes directly when Browser was opened straight into a page', () => {
    const switchTab = vi.fn();
    const setOpen = vi.fn();
    renderHook(() => useBrowserBackStack({
      open: true, historyActive: false, switchTab, setOpen,
    }));

    expect(window.history.pushState).toHaveBeenCalledTimes(1);
    pop();
    expect(switchTab).not.toHaveBeenCalled();
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('does not let an old close traversal shut an immediately reopened Browser', async () => {
    window.history.back.mockRestore();
    window.history.go.mockRestore();
    const switchTab = vi.fn();
    const setOpen = vi.fn();
    const { rerender } = renderHook(
      ({ open, historyActive }) => useBrowserBackStack({
        open, historyActive, switchTab, setOpen,
      }),
      { initialProps: { open: true, historyActive: true } },
    );
    rerender({ open: true, historyActive: false });
    rerender({ open: false, historyActive: false });
    rerender({ open: true, historyActive: true });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(setOpen).not.toHaveBeenCalledWith(false);
  });
});
