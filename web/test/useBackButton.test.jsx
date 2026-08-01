// web/test/useBackButton.test.jsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useBackButton, useHistoryLayer, unwindHistory } from '../src/hooks/useBackButton.js';

function Harness({ active, onClose }) { useBackButton(active, onClose); return null; }

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const render = (props) => act(() => root.render(<Harness {...props} />));

describe('useBackButton', () => {
  it('pushes one history entry when activated', () => {
    const push = vi.spyOn(window.history, 'pushState');
    render({ active: true, onClose: vi.fn() });
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ overlay: true, overlayId: expect.any(Number) }), '');
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

  it('routes Escape through history Back', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render({ active: true, onClose: vi.fn() });
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true,
    })));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('consumes its pushed entry when closed by other means (history stays balanced)', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render({ active: true, onClose: vi.fn() }); // pushes {overlay:true}
    render({ active: false, onClose: vi.fn() }); // cleanup → still our entry → history.back()
    expect(back).toHaveBeenCalled();
  });

  it('does not push again when re-rendered while still active (swap stays one entry)', () => {
    // A swap pair (manage↔rename) keeps `active` true across the swap while
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

  it('closes only the top history-backed layer on one popstate', () => {
    const first = vi.fn();
    const second = vi.fn();
    const Nested = ({ child }) => {
      useBackButton(true, first);
      useBackButton(child, second);
      return null;
    };
    act(() => root.render(<Nested child />));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('does not close the parent when a nested layer is dismissed by its own control', () => {
    const parentClose = vi.fn();
    const childClose = vi.fn();
    const Nested = ({ child }) => {
      useBackButton(true, parentClose);
      useBackButton(child, childClose);
      return null;
    };
    vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    act(() => root.render(<Nested child />));
    act(() => root.render(<Nested child={false} />));
    expect(parentClose).not.toHaveBeenCalled();
  });

  it('lets a custom multi-level history owner sit above a normal parent layer', () => {
    const parentClose = vi.fn();
    const childBack = vi.fn();
    const Nested = () => {
      useBackButton(true, parentClose);
      useHistoryLayer(true, childBack);
      return null;
    };
    act(() => root.render(<Nested />));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(childBack).toHaveBeenCalledTimes(1);
    expect(parentClose).not.toHaveBeenCalled();
  });

  it('does not close the parent when a custom history owner unwinds on direct close', () => {
    const parentClose = vi.fn();
    const childBack = vi.fn();
    const Nested = ({ child }) => {
      useBackButton(true, parentClose);
      useHistoryLayer(child, childBack);
      useEffect(() => {
        if (!child) return undefined;
        return () => unwindHistory(1);
      }, [child]);
      return null;
    };
    vi.spyOn(window.history, 'go').mockImplementation(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    act(() => root.render(<Nested child />));
    act(() => root.render(<Nested child={false} />));
    expect(parentClose).not.toHaveBeenCalled();
    expect(childBack).not.toHaveBeenCalled();
  });
});
