import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import KeyBar from '../src/components/KeyBar.jsx';

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
  vi.useRealTimers();
});

const render = (props) => act(() => root.render(<KeyBar {...props} />));
const btn = (id) => container.querySelector(`[data-key="${id}"]`);
const fire = (node, type, EventCtor = MouseEvent) =>
  act(() => node.dispatchEvent(new EventCtor(type, { bubbles: true })));

describe('KeyBar', () => {
  it('renders every key', () => {
    render({ onKey: vi.fn(), onText: vi.fn() });
    for (const id of ['esc', 'up', 'tab', 'left', 'down', 'right',
      'n1', 'n2', 'n3', 'slash', 'at', 'space', 'ctrlc', 'bang',
      'compact', 'model', 'effort', 'plugin', 'stab', 'ctrll']) {
      expect(btn(id)).not.toBeNull();
    }
    // ⌫ and Enter moved to the dock's right rail — not in the KeyBar.
    expect(btn('del')).toBeNull();
    expect(btn('enter')).toBeNull();
  });

  it('a named key calls onKey with the tmux key name', () => {
    const onKey = vi.fn();
    const onText = vi.fn();
    render({ onKey, onText });
    fire(btn('esc'), 'click');
    fire(btn('stab'), 'click');
    fire(btn('ctrll'), 'click');
    expect(onKey).toHaveBeenCalledWith('Escape');
    expect(onKey).toHaveBeenCalledWith('BTab');
    expect(onKey).toHaveBeenCalledWith('C-l');
    expect(onText).not.toHaveBeenCalled();
  });

  it('a character key (incl. slash-command shortcut) calls onText without Enter semantics', () => {
    const onKey = vi.fn();
    const onText = vi.fn();
    render({ onKey, onText });
    fire(btn('n1'), 'click');
    fire(btn('slash'), 'click');
    fire(btn('bang'), 'click');
    fire(btn('compact'), 'click');
    expect(onText).toHaveBeenCalledWith('1');
    expect(onText).toHaveBeenCalledWith('/');
    expect(onText).toHaveBeenCalledWith('!');
    expect(onText).toHaveBeenCalledWith('/compact');
    expect(onKey).not.toHaveBeenCalled();
  });

  it('arrow presses follow the current pane after onKey changes (no stale repeater)', () => {
    const onKey1 = vi.fn();
    const onKey2 = vi.fn();
    render({ onKey: onKey1, onText: vi.fn() });
    fire(btn('up'), 'pointerdown'); // first press creates the repeater (captures onKey1's dispatch)
    fire(btn('up'), 'pointerup');
    expect(onKey1).toHaveBeenCalledWith('Up');

    // Switching panes makes App hand KeyBar a new onKey (new pane id).
    render({ onKey: onKey2, onText: vi.fn() });
    onKey1.mockClear();
    fire(btn('up'), 'pointerdown');
    fire(btn('up'), 'pointerup');
    expect(onKey2).toHaveBeenCalledWith('Up'); // goes to the new pane…
    expect(onKey1).not.toHaveBeenCalled(); // …not the stale first pane
  });

  it('a tap fires exactly once (no double-fire from compat mouse events)', () => {
    const onKey = vi.fn();
    render({ onKey, onText: vi.fn() });
    // Arrows listen to pointer events only, so the browser's post-touch mousedown is a no-op.
    fire(btn('left'), 'pointerdown');
    fire(btn('left'), 'pointerup');
    fire(btn('left'), 'mousedown'); // compat mouse event after a touch — must NOT count
    fire(btn('left'), 'mouseup');
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onKey).toHaveBeenCalledWith('Left');
  });

  it('holding an arrow repeats, releasing stops', () => {
    vi.useFakeTimers();
    const onKey = vi.fn();
    render({ onKey, onText: vi.fn() });
    fire(btn('up'), 'pointerdown');          // 1 (immediate)
    act(() => vi.advanceTimersByTime(400 + 120 + 120)); // +2
    fire(btn('up'), 'pointerup');
    act(() => vi.advanceTimersByTime(1000));
    expect(onKey).toHaveBeenCalledTimes(3);
    expect(onKey).toHaveBeenCalledWith('Up');
  });
});
