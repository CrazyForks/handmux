import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import CmdFavEditor from '../src/components/CmdFavEditor.jsx';
import { loadFavs, saveFavs, cmdScope, CMD_GLOBAL } from '../src/favStore.js';
import { loadShortcutLayout } from '../src/shortcutLayout.js';

let container, root;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

const render = (props) => act(() => root.render(<CmdFavEditor windowId="@3" onClose={vi.fn()} {...props} />));
const click = (node) => act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const setInput = (input, value) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
// Add / edit all happen in a centred card; open it via the header ＋ (add) or by tapping a row (edit).
const openAdd = () => click(container.querySelector('.cmd-add-open'));
const card = () => container.querySelector('.cmd-addcard');
const addInput = () => card().querySelector('.cmd-add-input');
const saveBtn = () => card().querySelector('.cmd-submit');
const seg = (name) => [...card().querySelectorAll('.cmd-seg-btn')].find((n) => n.textContent === name);
const modeTab = (name) => [...card().querySelectorAll('.cmd-modetab')].find((n) => n.textContent === name);
// In 按键 mode there are two dropdowns: [0] = sticky key, [1] = base key. Pick option `label` from the i-th.
const dd = (i) => card().querySelectorAll('.cmd-dd')[i];
const pickFromDD = (i, label) => {
  click(dd(i).querySelector('.cmd-dd-btn'));
  click([...dd(i).querySelectorAll('.cmd-dd-opt')].find((n) => n.textContent === label));
};

describe('CmdFavEditor', () => {
  it('renders a global section always and a window section only when a windowId is given', () => {
    render({ windowId: null });
    expect(container.querySelectorAll('.cmd-esection')).toHaveLength(1);
    render({ windowId: '@3' });
    expect(container.querySelectorAll('.cmd-esection')).toHaveLength(2);
  });

  it('adds a command; the 带回车 switch stores enter and shows a ⏎', () => {
    render();
    openAdd();
    setInput(addInput(), 'npm test');
    click(card().querySelector('.cmd-switch input')); // flip 带回车
    click(saveBtn());
    expect(loadFavs(CMD_GLOBAL)).toEqual([{ kind: 'cmd', text: 'npm test', enter: true }]);
    expect(container.querySelector('.cmd-esection .cmd-enter')).not.toBeNull();
  });

  it('the 全局/窗口 segmented switch sends the add to the window list', () => {
    render();
    openAdd();
    click(seg('当前窗口')); // scope global → window
    setInput(addInput(), 'make');
    click(saveBtn());
    expect(loadFavs(cmdScope('@3')).map((f) => f.text)).toEqual(['make']);
    expect(loadFavs(CMD_GLOBAL)).toEqual([]);
  });

  it('the 按键 tab picks a sticky key + base key to build a fav (Ctrl+C) — no ⏎, shows the Ctrl+C label', () => {
    render();
    openAdd();
    click(modeTab('按键')); // mode → key
    pickFromDD(0, 'Ctrl');  // sticky-key dropdown → Ctrl
    pickFromDD(1, 'C');     // base-key dropdown → C
    click(saveBtn());
    expect(loadFavs(CMD_GLOBAL)).toEqual([{ kind: 'key', text: 'C-c', label: 'Ctrl+C' }]);
    expect([...container.querySelectorAll('.cmd-fav-text')].some((n) => n.textContent.includes('Ctrl+C'))).toBe(true);
  });

  it('the base-key picker can bind a named key (Ctrl + ↑) without typing', () => {
    render();
    openAdd();
    click(modeTab('按键'));
    pickFromDD(0, 'Ctrl');   // sticky → Ctrl
    pickFromDD(1, '↑ Up');   // base → the Up arrow, selected not typed
    click(saveBtn());
    expect(loadFavs(CMD_GLOBAL)).toEqual([{ kind: 'key', text: 'C-Up', label: 'Ctrl+Up' }]);
  });

  it('tapping a command row re-opens the card to edit it in place', () => {
    saveFavs(CMD_GLOBAL, [{ kind: 'cmd', text: 'old', enter: false }]);
    render();
    click(container.querySelector('.cmd-esection .cmd-fav-text')); // tap row → edit
    setInput(addInput(), 'new cmd');
    click(saveBtn());
    expect(loadFavs(CMD_GLOBAL)).toEqual([{ kind: 'cmd', text: 'new cmd', enter: false }]);
  });

  it('editing a key fav seeds the sticky-key + base back from the chord', () => {
    saveFavs(CMD_GLOBAL, [{ kind: 'key', text: 'C-c', label: 'Ctrl+C' }]);
    render();
    click(container.querySelector('.cmd-esection .cmd-fav-text')); // tap row → edit (Ctrl + 'c' pre-filled)
    pickFromDD(1, 'D');                                            // re-pick just the base key
    click(saveBtn());
    expect(loadFavs(CMD_GLOBAL)).toEqual([{ kind: 'key', text: 'C-d', label: 'Ctrl+D' }]);
  });

  it('chat variant: one global section, no scope picker; a message saves to the agent list', () => {
    localStorage.setItem('hm_favs6_agent', JSON.stringify([])); // start empty
    act(() => root.render(<CmdFavEditor variant="chat" onClose={vi.fn()} />));
    expect(container.querySelectorAll('.cmd-esection')).toHaveLength(1); // single list, no per-window
    openAdd();
    expect(card().querySelector('.cmd-seg')).toBeNull();                 // no 全局/窗口 segmented
    expect(card().querySelector('.cmd-toggle-row')).not.toBeNull();      // chat also configures Enter explicitly
    expect(card().querySelector('.cmd-switch input').checked).toBe(true); // default keeps historical tap-to-send
    setInput(addInput(), '用中文回答');
    click(saveBtn());
    expect(loadFavs('agent')).toEqual([{ kind: 'reply', text: '用中文回答', enter: true }]);
  });

  it('merges shared presets and phone-local global items in the effective order', () => {
    saveFavs(CMD_GLOBAL, [{ kind: 'cmd', text: 'local', enter: false }]);
    render({ presets: [{ type: 'key', key: 'C-c', label: 'Ctrl+C' }] });
    const global = container.querySelectorAll('.cmd-esection')[0];
    expect([...global.querySelectorAll('.cmd-text')].map((node) => node.textContent))
      .toEqual(['Ctrl+C', 'local']);
    expect(container.querySelector('.cmd-config-section')).toBeNull();
  });

  it('moves a shared preset across a local item and persists the effective order', () => {
    saveFavs(CMD_GLOBAL, [{ kind: 'cmd', text: 'local', enter: false }]);
    render({ presets: [{ type: 'key', key: 'C-c', label: 'Ctrl+C' }] });
    const global = container.querySelectorAll('.cmd-esection')[0];
    click([...global.querySelectorAll('.cmd-row')][1].querySelector('.cmd-move.up'));
    expect([...global.querySelectorAll('.cmd-text')].map((node) => node.textContent))
      .toEqual(['local', 'Ctrl+C']);
    expect(loadShortcutLayout('command').order).toEqual(['text:local:no-enter', 'key:C-c']);
  });

  it('removes a shared preset from this device and undo restores its position', () => {
    vi.useFakeTimers();
    render({ presets: [
      { type: 'key', key: 'C-c', label: 'Ctrl+C' },
      { type: 'key', key: 'Escape', label: 'Esc' },
    ] });
    const first = container.querySelector('.cmd-esection .cmd-row');
    expect(first.querySelector('.cmd-del').getAttribute('aria-label')).toBe('从本机移除');
    click(first.querySelector('.cmd-del'));
    expect(container.textContent).not.toContain('Ctrl+C');
    expect(loadShortcutLayout('command').hidden).toEqual(['key:C-c']);
    click(container.querySelector('.cmd-undo'));
    expect([...container.querySelectorAll('.cmd-esection .cmd-text')].map((node) => node.textContent))
      .toEqual(['Ctrl+C', 'Esc']);
  });

  it('undo keeps the shared preset slot after remaining items are reordered', () => {
    vi.useFakeTimers();
    saveFavs(CMD_GLOBAL, [{ kind: 'cmd', text: 'local', enter: false }]);
    render({ presets: [
      { type: 'key', key: 'Escape', label: 'Esc' },
      { type: 'key', key: 'C-c', label: 'Ctrl+C' },
    ] });
    const global = container.querySelectorAll('.cmd-esection')[0];
    click(global.querySelector('.cmd-row .cmd-del'));
    click([...global.querySelectorAll('.cmd-row')][1].querySelector('.cmd-move.up'));
    expect([...global.querySelectorAll('.cmd-text')].map((node) => node.textContent))
      .toEqual(['local', 'Ctrl+C']);
    click(container.querySelector('.cmd-undo'));
    expect([...global.querySelectorAll('.cmd-text')].map((node) => node.textContent))
      .toEqual(['Esc', 'local', 'Ctrl+C']);
  });

  it('shows a window-local shortcut when its shared global identity is hidden', () => {
    localStorage.setItem('hm_shortcut_layout1_command', JSON.stringify({ hidden: ['key:C-c'], order: [] }));
    saveFavs(cmdScope('@3'), [{ kind: 'key', text: 'C-c', label: 'Ctrl+C' }]);
    render({ presets: [{ type: 'key', key: 'C-c', label: 'Ctrl+C' }] });
    const [global, win] = container.querySelectorAll('.cmd-esection');
    expect(global.textContent).not.toContain('Ctrl+C');
    expect([...win.querySelectorAll('.cmd-text')].map((node) => node.textContent)).toEqual(['Ctrl+C']);
  });

  it('deduplicates a window-local shortcut while its global identity is visible', () => {
    saveFavs(cmdScope('@3'), [{ kind: 'key', text: 'C-c', label: 'Ctrl+C' }]);
    render({ presets: [{ type: 'key', key: 'C-c', label: 'Ctrl+C' }] });
    const [global, win] = container.querySelectorAll('.cmd-esection');
    expect([...global.querySelectorAll('.cmd-text')].map((node) => node.textContent)).toEqual(['Ctrl+C']);
    expect(win.textContent).not.toContain('Ctrl+C');
  });

  it('moves across a hidden global duplicate by swapping the visible window neighbours', () => {
    saveFavs(cmdScope('@3'), [
      { kind: 'cmd', text: 'B', enter: false },
      { kind: 'cmd', text: 'duplicate', enter: false },
      { kind: 'cmd', text: 'C', enter: false },
    ]);
    render({ presets: [{ type: 'text', text: 'duplicate', enter: false }] });
    const win = container.querySelectorAll('.cmd-esection')[1];
    expect([...win.querySelectorAll('.cmd-text')].map((node) => node.textContent)).toEqual(['B', 'C']);
    click([...win.querySelectorAll('.cmd-row')][1].querySelector('.cmd-move.up'));
    expect([...win.querySelectorAll('.cmd-text')].map((node) => node.textContent)).toEqual(['C', 'B']);
    expect(loadFavs(cmdScope('@3')).map((f) => f.text)).toEqual(['C', 'duplicate', 'B']);
  });

  it('keeps a same-scope edit open and preserves data/layout when the new text conflicts', () => {
    saveFavs(CMD_GLOBAL, [
      { kind: 'cmd', text: 'one', enter: false },
      { kind: 'cmd', text: 'two', enter: false },
    ]);
    localStorage.setItem('hm_shortcut_layout1_command', JSON.stringify({
      hidden: [], order: ['text:one:no-enter', 'text:two:no-enter'],
    }));
    render();
    click(container.querySelector('.cmd-esection .cmd-fav-text'));
    setInput(addInput(), 'two');
    click(saveBtn());
    expect(loadFavs(CMD_GLOBAL).map((f) => f.text)).toEqual(['one', 'two']);
    expect(loadShortcutLayout('command')).toEqual({
      hidden: [], order: ['text:one:no-enter', 'text:two:no-enter'],
    });
    expect(card()).not.toBeNull();
    expect(card().querySelector('.cmd-add-error').textContent).toContain('已存在');
    expect(addInput().value).toBe('two');
  });

  it.each([
    ['全局 → 当前窗口', 0, '当前窗口'],
    ['当前窗口 → 全局', 1, '全局'],
  ])('keeps a conflicting %s edit transactional and open', (_name, sourceSection, targetLabel) => {
    saveFavs(CMD_GLOBAL, [{ kind: 'cmd', text: sourceSection === 0 ? 'source' : 'taken', enter: false }]);
    saveFavs(cmdScope('@3'), [{ kind: 'cmd', text: sourceSection === 1 ? 'source' : 'taken', enter: false }]);
    localStorage.setItem('hm_shortcut_layout1_command', JSON.stringify({
      hidden: ['key:Escape'], order: ['text:taken:no-enter'],
    }));
    render();
    const section = container.querySelectorAll('.cmd-esection')[sourceSection];
    click([...section.querySelectorAll('.cmd-fav-text')].find((node) => node.textContent === 'source'));
    click(seg(targetLabel));
    setInput(addInput(), 'taken');
    click(saveBtn());
    expect(loadFavs(CMD_GLOBAL).map((f) => f.text)).toEqual([sourceSection === 0 ? 'source' : 'taken']);
    expect(loadFavs(cmdScope('@3')).map((f) => f.text)).toEqual([sourceSection === 1 ? 'source' : 'taken']);
    expect(loadShortcutLayout('command')).toEqual({
      hidden: ['key:Escape'], order: ['text:taken:no-enter'],
    });
    expect(card()).not.toBeNull();
    expect(card().querySelector('.cmd-add-error').textContent).toContain('已存在');
  });

  it('rejects a global edit that would collide with a visible shared preset identity', () => {
    saveFavs(CMD_GLOBAL, [{ kind: 'cmd', text: 'source', enter: false }]);
    localStorage.setItem('hm_shortcut_layout1_command', JSON.stringify({
      hidden: [], order: ['text:source:no-enter', 'text:taken:no-enter'],
    }));
    render({ presets: [{ type: 'text', text: 'taken', enter: false }] });
    click([...container.querySelectorAll('.cmd-esection')[0].querySelectorAll('.cmd-fav-text')]
      .find((node) => node.textContent === 'source'));
    setInput(addInput(), 'taken');
    click(saveBtn());
    expect(loadFavs(CMD_GLOBAL).map((f) => f.text)).toEqual(['source']);
    expect(loadShortcutLayout('command').order).toEqual(['text:source:no-enter', 'text:taken:no-enter']);
    expect(card()).not.toBeNull();
    expect(card().querySelector('.cmd-add-error').textContent).toContain('已存在');
  });

  it('rejects a window edit that would collide with an effective local Global identity', () => {
    saveFavs(CMD_GLOBAL, [{ kind: 'cmd', text: 'taken', enter: false }]);
    saveFavs(cmdScope('@3'), [{ kind: 'cmd', text: 'source', enter: false }]);
    render();
    const win = container.querySelectorAll('.cmd-esection')[1];
    click([...win.querySelectorAll('.cmd-fav-text')].find((node) => node.textContent === 'source'));
    setInput(addInput(), 'taken');
    click(saveBtn());
    expect(loadFavs(cmdScope('@3')).map((f) => f.text)).toEqual(['source']);
    expect(card()).not.toBeNull();
    expect(card().querySelector('.cmd-add-error').textContent).toContain('已存在');
  });

  it('does not exempt a same-text sibling identity when transferring Global → window', () => {
    saveFavs(CMD_GLOBAL, [
      { kind: 'cmd', text: 'ok', enter: false },
      { kind: 'cmd', text: 'ok', enter: true },
    ]);
    localStorage.setItem('hm_shortcut_layout1_command', JSON.stringify({
      hidden: [], order: ['text:ok:no-enter', 'text:ok:enter'],
    }));
    render();
    const global = container.querySelectorAll('.cmd-esection')[0];
    click([...global.querySelectorAll('.cmd-fav-text')].find((node) => node.textContent === 'ok'));
    click(seg('当前窗口'));
    click(card().querySelector('.cmd-switch input')); // no-enter source → enter sibling identity
    click(saveBtn());
    expect(loadFavs(CMD_GLOBAL)).toEqual([
      { kind: 'cmd', text: 'ok', enter: false },
      { kind: 'cmd', text: 'ok', enter: true },
    ]);
    expect(loadFavs(cmdScope('@3'))).toEqual([]);
    expect(loadShortcutLayout('command')).toEqual({
      hidden: [], order: ['text:ok:no-enter', 'text:ok:enter'],
    });
    expect(card()).not.toBeNull();
    expect(addInput().value).toBe('ok');
    expect(card().querySelector('.cmd-add-error').textContent).toContain('已存在');
  });

  it('rejects a window → Global transfer that would collide with a visible shared preset identity', () => {
    saveFavs(cmdScope('@3'), [{ kind: 'cmd', text: 'source', enter: false }]);
    localStorage.setItem('hm_shortcut_layout1_command', JSON.stringify({
      hidden: ['key:Escape'], order: ['text:taken:no-enter'],
    }));
    render({ presets: [{ type: 'text', text: 'taken', enter: false }] });
    const win = container.querySelectorAll('.cmd-esection')[1];
    click([...win.querySelectorAll('.cmd-fav-text')].find((node) => node.textContent === 'source'));
    click(seg('全局'));
    setInput(addInput(), 'taken');
    click(saveBtn());
    expect(loadFavs(CMD_GLOBAL)).toEqual([]);
    expect(loadFavs(cmdScope('@3')).map((f) => f.text)).toEqual(['source']);
    expect(loadShortcutLayout('command')).toEqual({
      hidden: ['key:Escape'], order: ['text:taken:no-enter'],
    });
    expect(card()).not.toBeNull();
  });

  it('rejects adding a window item hidden by an effective Global identity and preserves input', () => {
    saveFavs(CMD_GLOBAL, [{ kind: 'cmd', text: 'taken', enter: false }]);
    render();
    openAdd();
    click(seg('当前窗口'));
    setInput(addInput(), 'taken');
    click(saveBtn());
    expect(loadFavs(cmdScope('@3'))).toEqual([]);
    expect(card()).not.toBeNull();
    expect(addInput().value).toBe('taken');
    expect(card().querySelector('.cmd-add-error').textContent).toContain('已存在');
  });

  it('re-adding a hidden shortcut clears the hidden identity', () => {
    localStorage.setItem('hm_shortcut_layout1_command', JSON.stringify({ hidden: ['key:C-c'], order: [] }));
    render({ presets: [{ type: 'key', key: 'C-c', label: 'Ctrl+C' }] });
    openAdd();
    click(modeTab('按键'));
    pickFromDD(0, 'Ctrl');
    pickFromDD(1, 'C');
    click(saveBtn());
    expect(container.textContent).toContain('Ctrl+C');
    expect(loadShortcutLayout('command').hidden).toEqual([]);
  });

  it('creates the exact stale-hidden text action when only a same-text different-Enter local exists', () => {
    saveFavs(CMD_GLOBAL, [{ kind: 'cmd', text: 'ok', enter: false }]);
    localStorage.setItem('hm_shortcut_layout1_command', JSON.stringify({
      hidden: ['text:ok:enter'], order: [],
    }));
    render({ presets: [] }); // the server preset that created hidden has since been removed
    openAdd();
    setInput(addInput(), 'ok');
    click(card().querySelector('.cmd-switch input')); // request the exact text:ok:enter action
    click(saveBtn());
    expect(loadFavs(CMD_GLOBAL)).toEqual([
      { kind: 'cmd', text: 'ok', enter: false },
      { kind: 'cmd', text: 'ok', enter: true },
    ]);
    expect(loadShortcutLayout('command').hidden).toEqual([]);
    expect([...container.querySelectorAll('.cmd-esection')[0].querySelectorAll('.cmd-text')]
      .map((node) => node.textContent)).toEqual(['ok', 'ok⏎']);
  });

  it('chat variant: a slash message is stored as a cmd, and 按键 tab saves a bare key fav (Esc)', () => {
    localStorage.setItem('hm_favs6_agent', JSON.stringify([]));
    act(() => root.render(<CmdFavEditor variant="chat" onClose={vi.fn()} />));
    openAdd();
    setInput(addInput(), '/compact');
    click(saveBtn());
    openAdd();
    click(modeTab('按键'));
    pickFromDD(1, '⎋ Esc'); // no modifier — a named key is sendable on its own
    click(saveBtn());
    expect(loadFavs('agent')).toEqual([
      { kind: 'cmd', text: '/compact', enter: true },
      { kind: 'key', text: 'Escape', label: 'Esc' },
    ]);
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
    expect(loadShortcutLayout('command').order).toEqual(['text:two:no-enter', 'text:one:no-enter']);
  });
});
