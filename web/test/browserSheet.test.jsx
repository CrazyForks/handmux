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
  consentOpen: false,
  enableAccess: vi.fn(),
  cancelAccess: vi.fn(),
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
const clickAndFlush = (node) => act(async () => {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await Promise.resolve();
});
const submit = (form) => act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const setInput = (input, value) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('BrowserSheet', () => {
  it('explains computer-side access before first use and requires an explicit enable action', async () => {
    const model = browser({ open: false, consentOpen: true });
    await render(model);
    expect(document.querySelector('.browser-consent').textContent).toContain('通过你的电脑访问网页');
    click(document.querySelector('.browser-consent-enable'));
    expect(model.enableAccess).toHaveBeenCalledOnce();
  });
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

  it('shows page loading state initially and while refresh is in flight', async () => {
    await render(browser());
    const frame = document.querySelector('iframe[data-tab-id="a"]');
    expect(document.querySelector('.browser-page-loading')).not.toBeNull();

    act(() => frame.dispatchEvent(new Event('load')));
    expect(document.querySelector('.browser-page-loading')).toBeNull();

    click(document.querySelector('button[aria-label="刷新"]'));
    expect(document.querySelector('.browser-page-loading')).not.toBeNull();
    act(() => frame.dispatchEvent(new Event('load')));
    expect(document.querySelector('.browser-page-loading')).toBeNull();

    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { source: 'handmux-browser', channel: 'ca', type: 'navigate', url: 'https://a.example/next' },
    })));
    expect(document.querySelector('.browser-page-loading')).not.toBeNull();
    act(() => frame.dispatchEvent(new Event('load')));
    expect(document.querySelector('.browser-page-loading')).toBeNull();
  });

  it('switches, closes, starts a new address and minimizes through the model', async () => {
    const model = browser();
    await render(model);
    await clickAndFlush([...document.querySelectorAll('[role="tab"]')][2]);
    click(document.querySelector('button[aria-label="关闭 Alpha"]'));
    click(document.querySelector('button[aria-label="新建标签页"]'));
    click(document.querySelector('button[aria-label="收起"]'));

    expect(model.switchTab).toHaveBeenNthCalledWith(1, 'b');
    expect(model.closeTab).toHaveBeenCalledWith('a');
    expect(model.switchTab).toHaveBeenNthCalledWith(2, 'history');
    expect(model.setOpen).toHaveBeenCalledWith(false);
  });

  it('keeps every iframe mounted and temporarily allows same-origin storage for compatibility validation', async () => {
    await render(browser());
    const frames = [...document.querySelectorAll('.browser-frame')];
    expect(frames).toHaveLength(2);
    expect(frames[0].closest('.browser-pane').hidden).toBe(false);
    expect(frames[1].closest('.browser-pane').hidden).toBe(true);
    for (const frame of frames) {
      const sandbox = frame.getAttribute('sandbox').split(/\s+/);
      expect(sandbox).toEqual(expect.arrayContaining([
        'allow-scripts', 'allow-forms', 'allow-downloads', 'allow-modals', 'allow-popups', 'allow-same-origin',
      ]));
      expect(sandbox.some((value) => value.startsWith('allow-top-navigation'))).toBe(false);
    }
  });

  it('keeps iframe state mounted and reloads a tab after its selection is committed', async () => {
    const model = browser({ switchTab: vi.fn().mockResolvedValue(true) });
    await render(model);
    const first = document.querySelector('iframe[data-tab-id="a"]');
    const second = document.querySelector('iframe[data-tab-id="b"]');
    const postFirst = vi.spyOn(first.contentWindow, 'postMessage');
    const postSecond = vi.spyOn(second.contentWindow, 'postMessage');
    const tabButtons = [...document.querySelectorAll('[role="tab"]')];

    await clickAndFlush(tabButtons[2]);
    expect(postSecond).not.toHaveBeenCalled();
    await render({ ...model, activeId: 'b' });
    await clickAndFlush([...document.querySelectorAll('[role="tab"]')][2]);
    await render({ ...model, activeId: 'b' });
    await clickAndFlush([...document.querySelectorAll('[role="tab"]')][1]);
    await render({ ...model, activeId: 'a' });

    expect(document.querySelector('iframe[data-tab-id="a"]')).toBe(first);
    expect(document.querySelector('iframe[data-tab-id="b"]')).toBe(second);
    expect(postSecond.mock.calls.map(([message]) => message)).toEqual([
      { source: 'handmux-browser-parent', channel: 'cb', command: 'reload' },
      { source: 'handmux-browser-parent', channel: 'cb', command: 'reload' },
    ]);
    expect(postFirst).toHaveBeenCalledWith({ source: 'handmux-browser-parent', channel: 'ca', command: 'reload' }, '*');
  });

  it('reloads only the last tab clicked when switch promises finish out of order', async () => {
    let resolveA;
    let resolveB;
    const switchTab = vi.fn((id) => new Promise((resolve) => {
      if (id === 'a') resolveA = resolve;
      if (id === 'b') resolveB = resolve;
    }));
    const model = browser({ switchTab });
    await render(model);
    const first = document.querySelector('iframe[data-tab-id="a"]');
    const second = document.querySelector('iframe[data-tab-id="b"]');
    const postFirst = vi.spyOn(first.contentWindow, 'postMessage');
    const postSecond = vi.spyOn(second.contentWindow, 'postMessage');
    const tabButtons = [...document.querySelectorAll('[role="tab"]')];

    click(tabButtons[2]);
    click(tabButtons[1]);
    await act(async () => { resolveA(true); await Promise.resolve(); });
    await render({ ...model, activeId: 'a' });
    await act(async () => { resolveB(true); await Promise.resolve(); });
    await render({ ...model, activeId: 'b' });

    expect(postFirst).toHaveBeenCalledWith({ source: 'handmux-browser-parent', channel: 'ca', command: 'reload' }, '*');
    expect(postSecond).not.toHaveBeenCalled();
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

  it('matches bridge messages by iframe when same-origin tabs share one session channel', async () => {
    const sharedTabs = tabs.map((tab) => ({ ...tab, channel: 'shared' }));
    const model = browser({ tabs: sharedTabs });
    await render(model);
    const frame = document.querySelector('iframe[data-tab-id="b"]');

    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { source: 'handmux-browser', channel: 'shared', type: 'title', url: 'https://b.example/next', title: 'Beta Next' },
    })));

    expect(model.updateTabMeta).toHaveBeenCalledWith('b', { url: 'https://b.example/next', title: 'Beta Next' });
  });

  it('moves page-driven cross-origin navigation through the server mapping', async () => {
    const model = browser();
    await render(model);
    const frame = document.querySelector('iframe[data-tab-id="a"]');

    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { source: 'handmux-browser', channel: 'ca', type: 'navigate', url: 'https://other.example/path', title: '' },
    })));

    expect(model.navigateTab).toHaveBeenCalledWith('a', 'https://other.example/path');
    expect(model.updateTabMeta).not.toHaveBeenCalled();
  });

  it('retries the same page-driven origin switch after a temporary API failure', async () => {
    const model = browser({ navigateTab: vi.fn().mockResolvedValue(null) });
    await render(model);
    const frame = document.querySelector('iframe[data-tab-id="a"]');
    const message = new MessageEvent('message', {
      source: frame.contentWindow,
      data: { source: 'handmux-browser', channel: 'ca', type: 'navigate', url: 'https://other.example/path', title: '' },
    });

    await act(async () => {
      window.dispatchEvent(message);
      await Promise.resolve();
    });
    act(() => window.dispatchEvent(message));

    expect(model.navigateTab).toHaveBeenCalledTimes(2);
  });

  it('offers exactly 10, 30, 60, 120 minutes and never', async () => {
    await render(browser());
    click(document.querySelector('button[aria-label="后台标签自动关闭"]'));
    const choices = [...document.querySelectorAll('.browser-time-option')];
    expect(choices.map((node) => node.textContent)).toEqual(['10 分钟', '30 分钟', '60 分钟', '120 分钟', '永不关闭']);
  });
});
