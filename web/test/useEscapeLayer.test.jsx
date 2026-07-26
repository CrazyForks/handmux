import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useEscapeLayer } from '../src/hooks/useEscapeLayer.js';

function Layer({ active, onEscape }) {
  useEscapeLayer(active, onEscape);
  return null;
}

function Harness({ parent = true, child = false, onParent, onChild }) {
  return (
    <>
      <Layer active={parent} onEscape={onParent} />
      <Layer active={child} onEscape={onChild} />
    </>
  );
}

let container;
let root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props) => act(() => root.render(<Harness {...props} />));
const pressEscape = () => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => window.dispatchEvent(event));
  return event;
};

describe('useEscapeLayer', () => {
  it('closes only the top layer, then the layer below', () => {
    const onParent = vi.fn();
    const onChild = vi.fn();
    render({ parent: true, child: true, onParent, onChild });

    pressEscape();
    expect(onChild).toHaveBeenCalledTimes(1);
    expect(onParent).not.toHaveBeenCalled();

    render({ parent: true, child: false, onParent, onChild });
    pressEscape();
    expect(onParent).toHaveBeenCalledTimes(1);
  });

  it('consumes Escape while a layer is active', () => {
    const onParent = vi.fn();
    const event = pressAfterRender({ parent: true, child: false, onParent, onChild: vi.fn() });
    expect(event.defaultPrevented).toBe(true);
    expect(onParent).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no layer is active', () => {
    const onParent = vi.fn();
    render({ parent: false, child: false, onParent, onChild: vi.fn() });
    const event = pressEscape();
    expect(event.defaultPrevented).toBe(false);
    expect(onParent).not.toHaveBeenCalled();
  });

  it('ignores key-repeat so holding Escape cannot cascade through layers', () => {
    const onParent = vi.fn();
    render({ parent: true, child: false, onParent, onChild: vi.fn() });
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', repeat: true, bubbles: true, cancelable: true,
    })));
    expect(onParent).not.toHaveBeenCalled();
  });
});

function pressAfterRender(props) {
  render(props);
  return pressEscape();
}
