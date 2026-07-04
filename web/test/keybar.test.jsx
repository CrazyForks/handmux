import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import KeyBar from '../src/components/KeyBar.jsx';

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

// mods are controlled (lifted to BottomDock in the app). Wrap KeyBar in a tiny stateful harness so the
// modifier arm/lock transitions actually take effect between fires.
function Harness(props) {
  const [mods, setMods] = useState({ ctrl: 'off', shift: 'off', alt: 'off' });
  return <KeyBar mods={mods} setMods={setMods} {...props} />;
}
const render = (props) => act(() => root.render(
  <Harness onKey={vi.fn()} onText={vi.fn()} mode="agent" onToggleMode={vi.fn()} onOpenFav={vi.fn()} {...props} />));
const btn = (id) => container.querySelector(`[data-key="${id}"]`);
const fire = (node, type, EventCtor = MouseEvent) => act(() => node.dispatchEvent(new EventCtor(type, { bubbles: true })));

describe('KeyBar two rows', () => {
  it('fixed row has the segmented switch, 常用, and Esc/Tab/Ctrl/Shift', () => {
    render();
    expect(container.querySelector('.keybar-seg')).not.toBeNull();
    expect(container.querySelector('.keybar-fav')).not.toBeNull();
    for (const id of ['esc', 'tab', 'ctrl', 'shift', 'del']) expect(btn(id)).not.toBeNull();
  });

  it('agent mode scroll row shows menu/slash keys; command mode shows shell symbols', () => {
    render({ mode: 'agent' });
    expect(btn('n1')).not.toBeNull();
    expect(btn('pipe')).toBeNull();
    render({ mode: 'command' });
    expect(btn('pipe')).not.toBeNull();
    expect(btn('n1')).toBeNull();
  });

  it('the segmented switch reflects mode and calls onToggleMode on the other side', () => {
    const onToggleMode = vi.fn();
    render({ mode: 'command', onToggleMode });
    const seg = container.querySelector('.keybar-seg');
    expect(seg.querySelector('[data-seg="command"]').getAttribute('aria-pressed')).toBe('true');
    fire(seg.querySelector('[data-seg="agent"]'), 'click');
    expect(onToggleMode).toHaveBeenCalled();
  });

  it('常用 button calls onOpenFav', () => {
    const onOpenFav = vi.fn();
    render({ onOpenFav });
    fire(container.querySelector('.keybar-fav'), 'click');
    expect(onOpenFav).toHaveBeenCalled();
  });

  it('a named key calls onKey; a symbol calls onText', () => {
    const onKey = vi.fn(), onText = vi.fn();
    render({ mode: 'command', onKey, onText });
    fire(btn('esc'), 'click');
    fire(btn('pipe'), 'click');
    expect(onKey).toHaveBeenCalledWith('Escape');
    expect(onText).toHaveBeenCalledWith('|');
  });

  it('armed Ctrl composes the next letter into C-<x> then resets', () => {
    const onKey = vi.fn(), onText = vi.fn();
    render({ mode: 'agent', onKey, onText });
    fire(btn('ctrl'), 'pointerdown'); // arm
    fire(btn('n1'), 'click');         // 1 -> C-1
    expect(onKey).toHaveBeenCalledWith('C-1');
    onKey.mockClear();
    fire(btn('n1'), 'click');         // reset -> plain text
    expect(onText).toHaveBeenCalledWith('1');
  });

  it('armed Shift turns Tab into BTab (Shift+Tab)', () => {
    const onKey = vi.fn();
    render({ mode: 'agent', onKey });
    fire(btn('shift'), 'pointerdown');
    fire(btn('tab'), 'click');
    expect(onKey).toHaveBeenCalledWith('BTab');
  });

  it('holding an arrow repeats, releasing stops', () => {
    vi.useFakeTimers();
    const onKey = vi.fn();
    render({ mode: 'command', onKey });
    fire(btn('up'), 'pointerdown');
    act(() => vi.advanceTimersByTime(400 + 120 + 120));
    fire(btn('up'), 'pointerup');
    act(() => vi.advanceTimersByTime(1000));
    expect(onKey).toHaveBeenCalledTimes(3);
    expect(onKey).toHaveBeenCalledWith('Up');
  });
});
