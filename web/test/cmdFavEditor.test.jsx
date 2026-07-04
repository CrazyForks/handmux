import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import CmdFavEditor from '../src/components/CmdFavEditor.jsx';
import { loadFavs, saveFavs, cmdScope, CMD_GLOBAL } from '../src/favStore.js';

let container, root;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = (props) => act(() => root.render(<CmdFavEditor windowId="@3" onClose={vi.fn()} {...props} />));
const click = (node) => act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const setInput = (input, value) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const addInput = () => container.querySelector('.cmd-add .fav-add-input');
const addBtn = () => container.querySelector('.cmd-add .fav-add-btn');
const tab = (name) => [...container.querySelectorAll('.cmd-tab')].find((n) => n.textContent === name);

describe('CmdFavEditor', () => {
  it('renders a global section always and a window section only when a windowId is given', () => {
    render({ windowId: null });
    expect(container.querySelectorAll('.cmd-esection')).toHaveLength(1);
    render({ windowId: '@3' });
    expect(container.querySelectorAll('.cmd-esection')).toHaveLength(2);
  });

  it('adds a command; the 带回车 toggle stores enter and shows a ⏎', () => {
    render();
    setInput(addInput(), 'npm test');
    click(container.querySelector('.cmd-enter-opt input')); // tick 带回车
    click(addBtn());
    expect(loadFavs(CMD_GLOBAL)).toEqual([{ kind: 'cmd', text: 'npm test', enter: true }]);
    expect(container.querySelector('.cmd-esection .cmd-enter')).not.toBeNull();
  });

  it('the left switch sends the add to the window list instead of the global one', () => {
    render();
    click(container.querySelector('.cmd-scope-sw')); // global → window
    setInput(addInput(), 'make');
    click(addBtn());
    expect(loadFavs(cmdScope('@3')).map((f) => f.text)).toEqual(['make']);
    expect(loadFavs(CMD_GLOBAL)).toEqual([]);
  });

  it('the 按键 tab builds a key fav (Ctrl+C) — no ⏎, shows the ⌃C label', () => {
    render();
    click(tab('按键'));
    click(container.querySelector('.cmd-mod[aria-label="ctrl"]')); // arm Ctrl
    setInput(addInput(), 'c');
    click(addBtn());
    expect(loadFavs(CMD_GLOBAL)).toEqual([{ kind: 'key', text: 'C-c', label: '⌃C' }]);
    expect([...container.querySelectorAll('.cmd-fav-text')].some((n) => n.textContent === '⌃C')).toBe(true);
  });

  it('▲▼ reorder the list; the top item cannot move up', () => {
    saveFavs(CMD_GLOBAL, [{ kind: 'cmd', text: 'one' }, { kind: 'cmd', text: 'two' }]);
    render();
    const global = container.querySelectorAll('.cmd-esection')[0];
    const rows = () => [...global.querySelectorAll('.cmd-fav-text')].map((n) => n.textContent);
    expect(rows()).toEqual(['one', 'two']);
    expect(global.querySelector('.cmd-move.up').disabled).toBe(true);
    const twoRow = [...global.querySelectorAll('.cmd-row')][1];
    click(twoRow.querySelector('.cmd-move.up'));
    expect(rows()).toEqual(['two', 'one']);
    expect(loadFavs(CMD_GLOBAL).map((f) => f.text)).toEqual(['two', 'one']);
  });
});
