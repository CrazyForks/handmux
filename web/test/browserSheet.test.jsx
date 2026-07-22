import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import BrowserSheet from '../src/components/BrowserSheet.jsx';

let container;
let root;

const tabs = [
  { id: 'a', url: '/_browser-a/https://a.example/', originalUrl: 'https://a.example/', title: 'Alpha', channel: 'ca' },
  { id: 'b', url: '/_browser-b/https://b.example/', originalUrl: 'https://b.example/', title: 'Beta', channel: 'cb' },
];

const browser = (overrides = {}) => ({
  open: true,
  tabs,
  activeId: 'a',
  historyActive: false,
  closeAfter: 10,
  history: [{ url: 'https://old.example/', title: 'Old', visitedAt: 1000 }],
  error: null,
  openUrl: vi.fn(),
  switchTab: vi.fn(),
  closeTab: vi.fn(),
  setOpen: vi.fn(),
  setCloseAfter: vi.fn(),
  navigateTab: vi.fn(),
  updateTabMeta: vi.fn(),
  clearHistory: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const render = (model) => act(() => root.render(<BrowserSheet browser={model} />));
const click = (node) => act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const submit = (form) => act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const setInput = (input, value) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('BrowserSheet', () => {
  it('renders tabs above navigation with fixed History first', async () => {
    await render(browser());
    const sheet = document.querySelector('.browser-sheet');
    expect(sheet.children[0].classList.contains('browser-tabs')).toBe(true);
    expect(sheet.children[1].classList.contains('browser-nav')).toBe(true);
    const tabButtons = [...document.querySelectorAll('[role="tab"]')];
    expect(tabButtons.map((node) => node.textContent)).toEqual(['历史', 'Alpha', 'Beta']);
    expect(document.querySelector('.browser-history-tab .browser-tab-close')).toBeNull();
  });

  it('submits the editable address and sends browser navigation commands', async () => {
    const model = browser();
    await render(model);
    const input = document.querySelector('.browser-address');
    setInput(input, 'https://next.example/path');
    submit(document.querySelector('.browser-address-form'));
    expect(model.navigateTab).toHaveBeenCalledWith('a', 'https://next.example/path');

    const frame = document.querySelector('iframe[data-tab-id="a"]');
    const post = vi.spyOn(frame.contentWindow, 'postMessage');
    click(document.querySelector('button[aria-label="后退"]'));
    click(document.querySelector('button[aria-label="前进"]'));
    click(document.querySelector('button[aria-label="刷新"]'));
    expect(post.mock.calls.map(([message]) => message.command)).toEqual(['back', 'forward', 'reload']);
    expect(post.mock.calls.every(([message]) => message.channel === 'ca')).toBe(true);
  });

  it('switches, closes, starts a new address and minimizes through the model', async () => {
    const model = browser();
    await render(model);
    click([...document.querySelectorAll('[role="tab"]')][2]);
    click(document.querySelector('button[aria-label="关闭 Alpha"]'));
    click(document.querySelector('button[aria-label="新建标签页"]'));
    click(document.querySelector('button[aria-label="收起"]'));

    expect(model.switchTab).toHaveBeenNthCalledWith(1, 'b');
    expect(model.closeTab).toHaveBeenCalledWith('a');
    expect(model.switchTab).toHaveBeenNthCalledWith(2, 'history');
    expect(model.setOpen).toHaveBeenCalledWith(false);
  });

  it('keeps every iframe mounted and uses the strict sandbox', async () => {
    await render(browser());
    const frames = [...document.querySelectorAll('.browser-frame')];
    expect(frames).toHaveLength(2);
    expect(frames[0].closest('.browser-pane').hidden).toBe(false);
    expect(frames[1].closest('.browser-pane').hidden).toBe(true);
    for (const frame of frames) {
      const sandbox = frame.getAttribute('sandbox').split(/\s+/);
      expect(sandbox).toEqual(expect.arrayContaining([
        'allow-scripts', 'allow-forms', 'allow-downloads', 'allow-modals', 'allow-popups',
      ]));
      expect(sandbox).not.toContain('allow-same-origin');
      expect(sandbox.some((value) => value.startsWith('allow-top-navigation'))).toBe(false);
    }
  });

  it('accepts bridge messages only from the matching iframe and channel', async () => {
    const model = browser();
    await render(model);
    const frame = document.querySelector('iframe[data-tab-id="a"]');
    const data = { source: 'handmux-browser', channel: 'ca', type: 'title', url: 'https://a.example/next', title: 'Next' };

    act(() => window.dispatchEvent(new MessageEvent('message', { source: window, data })));
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { ...data, channel: 'wrong' } })));
    expect(model.updateTabMeta).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data })));
    expect(model.updateTabMeta).toHaveBeenCalledWith('a', { url: 'https://a.example/next', title: 'Next' });
  });

  it('offers exactly 10, 30, 60, 120 minutes and never', async () => {
    await render(browser());
    click(document.querySelector('button[aria-label="后台标签自动关闭"]'));
    const choices = [...document.querySelectorAll('.browser-time-option')];
    expect(choices.map((node) => node.textContent)).toEqual(['10 分钟', '30 分钟', '60 分钟', '120 分钟', '永不关闭']);
  });
});
