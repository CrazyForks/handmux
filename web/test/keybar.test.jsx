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
  it('renders the fixed core, the Ctrl modifier, and the default (agent) context keys', () => {
    render({ onKey: vi.fn(), onText: vi.fn() });
    for (const id of ['esc', 'up', 'tab', 'left', 'down', 'right', 'ctrl', // core + modifier
      'n1', 'n2', 'n3', 'slash', 'at', 'bang', 'stab', 'ctrlo', // agent page 1
      'compact', 'model', 'effort', 'plugin', 'loop', 'skill']) { // agent page 2
      expect(btn(id)).not.toBeNull();
    }
    // Shell-only keys aren't in the agent context; ⌫/Enter live on the dock rail, not here.
    expect(btn('pipe')).toBeNull();
    expect(btn('del')).toBeNull();
    expect(btn('enter')).toBeNull();
  });

  it('the shell context surfaces the buried shell symbols instead', () => {
    const onText = vi.fn();
    render({ onKey: vi.fn(), onText, context: 'shell' });
    for (const id of ['pipe', 'bslash', 'tilde', 'dash', 'under', 'gt', 'lt']) {
      expect(btn(id)).not.toBeNull();
    }
    fire(btn('pipe'), 'click');
    fire(btn('gt'), 'click');
    expect(onText).toHaveBeenCalledWith('|');
    expect(onText).toHaveBeenCalledWith('>');
  });

  it('a named key calls onKey with the tmux key name', () => {
    const onKey = vi.fn();
    const onText = vi.fn();
    render({ onKey, onText });
    fire(btn('esc'), 'click');
    fire(btn('stab'), 'click');
    fire(btn('ctrlo'), 'click');
    expect(onKey).toHaveBeenCalledWith('Escape');
    expect(onKey).toHaveBeenCalledWith('BTab');
    expect(onKey).toHaveBeenCalledWith('C-o');
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

  it('armed Ctrl composes the next key into C-<x> then auto-resets (one-shot)', () => {
    const onKey = vi.fn();
    const onText = vi.fn();
    render({ onKey, onText });
    fire(btn('ctrl'), 'pointerdown'); // arm
    fire(btn('n1'), 'click');         // 1 -> C-1 (a KEY, not text)
    expect(onKey).toHaveBeenCalledWith('C-1');
    expect(onText).not.toHaveBeenCalled();
    onKey.mockClear();
    fire(btn('n1'), 'click');         // modifier reset -> plain text again
    expect(onText).toHaveBeenCalledWith('1');
    expect(onKey).not.toHaveBeenCalled();
  });

  it('a fast double-tap locks Ctrl so it composes several keys', () => {
    const onKey = vi.fn();
    render({ onKey, onText: vi.fn() });
    fire(btn('ctrl'), 'pointerdown'); // tap 1
    fire(btn('ctrl'), 'pointerdown'); // tap 2 (same tick, <400ms) -> locked
    fire(btn('n1'), 'click');
    fire(btn('n2'), 'click');
    expect(onKey).toHaveBeenCalledWith('C-1');
    expect(onKey).toHaveBeenCalledWith('C-2'); // still active after the first — locked, not one-shot
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
