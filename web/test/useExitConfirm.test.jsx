// web/test/useExitConfirm.test.jsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useExitConfirm } from '../src/hooks/useExitConfirm.js';

function Harness({ enabled, onHint, windowMs }) { useExitConfirm(enabled, onHint, windowMs); return null; }

let container, root;
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  history.replaceState(null, '', location.pathname); // start from a clean (non-guard) top entry
  vi.useFakeTimers();
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
const render = (props) => act(() => root.render(<Harness {...props} />));
// The browser Back that CONSUMES our guard lands at root: top state is no longer {exitGuard}.
const backToRoot = () => act(() => { history.replaceState(null, '', location.pathname); window.dispatchEvent(new PopStateEvent('popstate')); });

describe('useExitConfirm', () => {
  it('pushes a guard entry when enabled', () => {
    const push = vi.spyOn(window.history, 'pushState');
    render({ enabled: true, onHint: vi.fn() });
    expect(push).toHaveBeenCalledWith({ exitGuard: true }, '');
  });

  it('arms on the first root Back (shows the hint)', () => {
    const onHint = vi.fn();
    render({ enabled: true, onHint, windowMs: 2000 });
    backToRoot();
    expect(onHint).toHaveBeenLastCalledWith(true);
  });

  it('hides the hint and re-traps Back in the SAME event when the window lapses (no dead zone)', () => {
    const onHint = vi.fn();
    render({ enabled: true, onHint, windowMs: 2000 });
    backToRoot();
    const push = vi.spyOn(window.history, 'pushState');
    act(() => vi.advanceTimersByTime(2000));
    expect(onHint).toHaveBeenLastCalledWith(false);            // hint gone...
    expect(push).toHaveBeenCalledWith({ exitGuard: true }, ''); // ...exactly when the guard re-traps
  });

  it('does not arm when Back lands back on the guard (an overlay above closed)', () => {
    const onHint = vi.fn();
    render({ enabled: true, onHint, windowMs: 2000 });
    act(() => window.dispatchEvent(new PopStateEvent('popstate'))); // state still {exitGuard}
    expect(onHint).not.toHaveBeenCalled();
  });

  it('hides a showing hint if disabled mid-window (no stuck toast)', () => {
    const onHint = vi.fn();
    render({ enabled: true, onHint, windowMs: 2000 });
    backToRoot();
    onHint.mockClear();
    render({ enabled: false, onHint }); // disable → cleanup while armed
    expect(onHint).toHaveBeenCalledWith(false);
  });
});
