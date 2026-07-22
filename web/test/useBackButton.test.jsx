// web/test/useBackButton.test.jsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useBackButton } from '../src/hooks/useBackButton.js';

function Harness({ active, onClose }) { useBackButton(active, onClose); return null; }

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const render = (props) => act(() => root.render(<Harness {...props} />));

describe('useBackButton', () => {
  it('pushes one history entry when activated', () => {
    const push = vi.spyOn(window.history, 'pushState');
    render({ active: true, onClose: vi.fn() });
    expect(push).toHaveBeenCalledWith({ overlay: true }, '');
  });

  it('does not touch history when inactive', () => {
    const push = vi.spyOn(window.history, 'pushState');
    render({ active: false, onClose: vi.fn() });
    expect(push).not.toHaveBeenCalled();
  });

  it('calls onClose when Back fires popstate', () => {
    const onClose = vi.fn();
    render({ active: true, onClose });
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(onClose).toHaveBeenCalled();
  });

  it('consumes its pushed entry when closed by other means (history stays balanced)', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render({ active: true, onClose: vi.fn() }); // pushes {overlay:true}
    render({ active: false, onClose: vi.fn() }); // cleanup → still our entry → history.back()
    expect(back).toHaveBeenCalled();
  });

  it('does not push again when re-rendered while still active (swap stays one entry)', () => {
    // A swap pair (settings↔changelog, manage↔rename) keeps `active` true across the swap while
    // swapping which onClose runs. Re-rendering active:true must NOT push a second history entry —
    // otherwise Back would need two presses and history could over-pop (the WebView race we hit before).
    const push = vi.spyOn(window.history, 'pushState');
    render({ active: true, onClose: vi.fn() });
    render({ active: true, onClose: vi.fn() }); // the "swap": same active, new handler
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('runs the latest onClose after a swap (Back closes the panel now on top)', () => {
    const first = vi.fn(); const second = vi.fn();
    render({ active: true, onClose: first });
    render({ active: true, onClose: second });
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops closing after deactivation (listener removed)', () => {
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const onClose = vi.fn();
    render({ active: true, onClose });
    render({ active: false, onClose });
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(onClose).not.toHaveBeenCalled();
  });
});
