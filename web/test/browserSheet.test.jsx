import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import BrowserSheet from '../src/components/BrowserSheet.jsx';

const styles = readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf8');

let container;
let root;

const tabs = [
  { id: 'a', mode: 'proxy', url: '/_browser-a/https://a.example/', originalUrl: 'https://a.example/', title: 'Alpha', channel: 'ca' },
  { id: 'b', mode: 'proxy', url: '/_browser-b/https://b.example/', originalUrl: 'https://b.example/', title: 'Beta', channel: 'cb' },
];

const browser = (overrides = {}) => ({
  open: true,
  accessEnabled: true,
  tabs,
  activeId: 'a',
  historyActive: false,
  closeAfter: 10,
  history: [{ url: 'https://old.example/', title: 'Old', visitedAt: 1000, lastMode: 'direct' }],
  proxyAvailable: true,
  error: null,
  consentOpen: false,
  enableAccess: vi.fn(),
  cancelAccess: vi.fn(),
  openUrl: vi.fn(),
  switchTab: vi.fn(),
  closeTab: vi.fn(),
  setOpen: vi.fn(),
  setCloseAfter: vi.fn(),
  setEnabled: vi.fn(),
  setPersistProxyLogin: vi.fn(),
  setProxyLoginRetentionDays: vi.fn(),
  setProxyLoginPolicy: vi.fn(),
  setHistoryMode: vi.fn(),
  clearProxyLogin: vi.fn(),
  deleteHistory: vi.fn(),
  navigateTab: vi.fn(),
  ensureBinding: vi.fn(),
  recoverBinding: vi.fn(),
  markBindingReady: vi.fn(),
  prepareFormNavigation: vi.fn(),
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
  vi.useRealTimers();
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
  it('explains direct and proxy access accurately before first use and requires an explicit enable action', async () => {
    const model = browser({ open: false, consentOpen: true });
    await render(model);
    const consent = document.querySelector('.browser-consent').textContent;
    expect(consent).toContain('手机直连');
    expect(consent).toContain('经电脑代理');
    expect(consent).not.toContain('关闭并销毁登录状态');
    const acknowledge = document.querySelector('.browser-consent-enable');
    expect(acknowledge.textContent).toBe('好的');
    click(acknowledge);
    expect(model.enableAccess).toHaveBeenCalledOnce();
  });
  it('renders tabs above navigation with a fixed icon-only Recent tab first', async () => {
    await render(browser());
    const sheet = document.querySelector('.browser-sheet');
    expect(sheet.children[0].classList.contains('browser-tabs')).toBe(true);
    expect(sheet.children[1].classList.contains('browser-nav')).toBe(true);
    const tabButtons = [...document.querySelectorAll('[role="tab"]')];
    expect(tabButtons.map((node) => node.textContent)).toEqual(['', 'Alpha', 'Beta']);
    const recent = document.querySelector('.browser-history-tab');
    expect(recent.getAttribute('aria-label')).toBe('最近访问');
    expect(recent.getAttribute('title')).toBe('最近访问');
    expect(recent.querySelector('svg')).not.toBeNull();
    expect(recent.querySelector('.browser-tab-close')).toBeNull();
  });

  it('marks proxy tabs orange and lets an existing tab switch modes in place', async () => {
    const model = browser();
    await render(model);
    const alpha = [...document.querySelectorAll('[role="tab"]')].find((node) => node.textContent.includes('Alpha'));
    expect(alpha.querySelector('.browser-mode-badge.proxy')).not.toBeNull();
    expect(alpha.closest('.browser-tab-wrap').classList.contains('proxy')).toBe(true);
    click(document.querySelector('button[aria-label="浏览器菜单"]'));
    const modeButtons = [...document.querySelectorAll('.browser-mode-segment button')];
    expect(modeButtons.map((node) => node.textContent)).toEqual(['手机直连', '经电脑代理']);
    expect(modeButtons.map((node) => node.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    click(modeButtons[0]);
    expect(model.navigateTab).toHaveBeenCalledWith('a', 'https://a.example/', 'direct');
  });

  it('closes the options card when entering History and does not revive it on return', async () => {
    const model = browser();
    await render(model);
    click(document.querySelector('button[aria-label="浏览器菜单"]'));
    expect(document.querySelector('.browser-options-card')).not.toBeNull();

    click(document.querySelector('.browser-history-tab'));
    await render({ ...model, historyActive: true });
    expect(document.querySelector('.browser-options-card')).toBeNull();
    await render({ ...model, historyActive: false });
    expect(document.querySelector('.browser-options-card')).toBeNull();
    expect(model.navigateTab).not.toHaveBeenCalled();
  });

  it('hides bridge-only controls on direct tabs and refreshes the iframe locally', async () => {
    const directTabs = tabs.map((tab) => tab.id === 'b'
      ? { ...tab, mode: 'direct', url: tab.originalUrl }
      : tab);
    const model = browser({ activeId: 'b', tabs: directTabs });
    await render(model);
    expect(document.querySelector('button[aria-label="后退"]')).toBeNull();
    expect(document.querySelector('button[aria-label="前进"]')).toBeNull();
    expect(document.querySelector('button[aria-label="停止加载"]')).toBeNull();
    const frame = document.querySelector('iframe[data-tab-id="b"]');
    act(() => frame.dispatchEvent(new Event('load')));
    click(document.querySelector('button[aria-label="刷新"]'));
    expect(document.querySelector('iframe[data-tab-id="b"]')).not.toBe(frame);
  });

  it('offers a manual proxy fallback only after a direct page stays loading', async () => {
    vi.useFakeTimers();
    const directTabs = [{ ...tabs[0], mode: 'direct', url: tabs[0].originalUrl }];
    try {
      const model = browser({ tabs: directTabs, activeId: 'a', proxyAvailable: true });
      await render(model);
      expect(document.querySelector('.browser-try-proxy')).toBeNull();
      act(() => vi.advanceTimersByTime(5000));
      const fallback = document.querySelector('.browser-try-proxy');
      expect(fallback.textContent).toBe('改用电脑代理');
      click(fallback);
      expect(model.navigateTab).toHaveBeenCalledWith('a', 'https://a.example/', 'proxy');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets history mode menus escape the rounded list instead of clipping them', () => {
    const rule = styles.match(/\.browser-history-list\s*\{([^}]*)\}/)?.[1] || '';
    expect(rule).not.toMatch(/overflow:\s*hidden/);
  });

  it('opens history in its last mode and supports a three-dot override', async () => {
    const model = browser();
    await render(model);
    click(document.querySelector('.browser-history-tab'));
    await render({ ...model, historyActive: true, activeId: null });
    click(document.querySelector('.browser-history-main'));
    expect(model.openUrl).toHaveBeenCalledWith('https://old.example/', { mode: 'direct' });
    click(document.querySelector('.browser-history-more'));
    click([...document.querySelectorAll('.browser-history-mode-option')].find((node) => node.textContent === '经电脑代理'));
    expect(model.openUrl).toHaveBeenLastCalledWith('https://old.example/', { mode: 'proxy' });
    expect(model.setHistoryMode).toHaveBeenCalledWith(model.history[0], 'proxy');
  });

  it('shows each history mode inline and keeps Cookie cleanup out of history-row menus', async () => {
    const model = browser({ historyActive: true, activeId: null });
    await render(model);

    expect(document.querySelector('.browser-history-mode.direct').textContent).toBe('直连');
    click(document.querySelector('.browser-history-more'));
    const menu = document.querySelector('.browser-history-mode-menu');
    expect(menu.textContent).toContain('手机直连');
    expect(menu.textContent).toContain('经电脑代理');
    expect(menu.textContent).not.toContain('清理本站代理 Cookie');
    expect(menu.textContent).toContain('删除此记录');
  });

  it('makes site-clear confirmation keyboard-modal and restores trigger focus', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const model = browser();
    await render(model);
    const menuTrigger = document.querySelector('button[aria-label="浏览器菜单"]');
    click(menuTrigger);
    const trigger = [...document.querySelectorAll('.browser-options-card button')]
      .find((node) => node.textContent === '清理本站代理 Cookie');
    trigger.focus();
    click(trigger);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });

    const dialog = document.querySelector('.browser-profile-confirm');
    const [cancel, confirm] = dialog.querySelectorAll('button');
    expect(document.activeElement).toBe(cancel);
    expect(document.querySelector('.browser-tabs').hasAttribute('inert')).toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
    })));
    expect(document.activeElement).toBe(confirm);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', bubbles: true, cancelable: true,
    })));
    expect(document.activeElement).toBe(cancel);
    outside.focus();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', bubbles: true, cancelable: true,
    })));
    expect(document.activeElement).toBe(cancel);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(document.querySelector('.browser-profile-confirm')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    outside.remove();
  });

  it('deletes history locally without invoking profile cleanup', async () => {
    const model = browser({ historyActive: true, activeId: null });
    await render(model);
    click(document.querySelector('.browser-history-more'));
    click([...document.querySelectorAll('.browser-history-mode-menu button')]
      .find((node) => node.textContent === '删除此记录'));

    expect(model.deleteHistory).toHaveBeenCalledWith(model.history[0]);
    expect(model.clearProxyLogin).not.toHaveBeenCalled();
  });

  it('uses an overridden history mode again in the same mount even when the first open fails', async () => {
    const model = browser({ historyActive: true, activeId: null, openUrl: vi.fn().mockResolvedValue(null) });
    function Harness() {
      const [history, setHistory] = useState(model.history);
      return <BrowserSheet browser={{
        ...model,
        history,
        setHistoryMode: (entry, mode) => {
          model.setHistoryMode(entry, mode);
          setHistory((current) => current.map((item) => item.url === entry.url ? { ...item, lastMode: mode } : item));
        },
      }} />;
    }
    await act(() => root.render(<Harness />));

    click(document.querySelector('.browser-history-more'));
    click([...document.querySelectorAll('.browser-history-mode-option')].find((node) => node.textContent === '经电脑代理'));
    click(document.querySelector('.browser-history-main'));

    expect(model.openUrl).toHaveBeenNthCalledWith(1, 'https://old.example/', { mode: 'proxy' });
    expect(model.openUrl).toHaveBeenNthCalledWith(2, 'https://old.example/', { mode: 'proxy' });
  });

  it('disables unavailable proxy choices in history and mode switching', async () => {
    const model = browser({ proxyAvailable: false, historyActive: true, activeId: null });
    await render(model);
    click(document.querySelector('.browser-history-more'));
    const proxy = [...document.querySelectorAll('.browser-history-mode-option')].find((node) => node.textContent === '经电脑代理');
    expect(proxy.disabled).toBe(true);
    const reason = document.querySelector('.browser-history-mode-menu p');
    expect(reason.textContent).toContain('当前服务器未开启浏览器代理');
    expect(proxy.getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('shows localized proxyUnavailable instead of opening stale proxy history', async () => {
    const model = browser({
      proxyAvailable: false, historyActive: true, activeId: null,
      history: [{ url: 'https://old.example/', title: 'Old', visitedAt: 1000, lastMode: 'proxy' }],
    });
    await render(model);

    click(document.querySelector('.browser-history-main'));

    expect(model.openUrl).not.toHaveBeenCalled();
    expect(document.querySelector('.browser-error').textContent).toContain('当前服务器未开启浏览器代理');
  });

  it('clears stale history errors when switching tabs or starting a valid address operation', async () => {
    const model = browser({
      proxyAvailable: false, historyActive: true, activeId: null,
      history: [{ url: 'https://old.example/', title: 'Old', visitedAt: 1000, lastMode: 'proxy' }],
    });
    await render(model);
    click(document.querySelector('.browser-history-main'));
    expect(document.querySelector('.browser-error')).not.toBeNull();

    await clickAndFlush([...document.querySelectorAll('[role="tab"]')]
      .find((node) => node.textContent.includes('Alpha')));
    expect(document.querySelector('.browser-error')).toBeNull();

    click(document.querySelector('.browser-history-main'));
    setInput(document.querySelector('.browser-address'), 'https://valid.example/');
    submit(document.querySelector('.browser-address-form'));
    expect(model.openUrl).toHaveBeenCalledWith('https://valid.example/', { mode: 'direct' });
    expect(document.querySelector('.browser-error')).toBeNull();
  });

  it('submits the editable address and refreshes through the same authoritative navigation path', async () => {
    const model = browser({ navigateTab: vi.fn().mockResolvedValue(tabs[0]) });
    await render(model);
    const input = document.querySelector('.browser-address');
    setInput(input, 'https://next.example/path');
    submit(document.querySelector('.browser-address-form'));
    expect(model.navigateTab).toHaveBeenCalledWith('a', 'https://next.example/path');

    const frame = document.querySelector('iframe[data-tab-id="a"]');
    act(() => frame.dispatchEvent(new Event('load')));
    const post = vi.spyOn(frame.contentWindow, 'postMessage');
    expect(document.querySelector('button[aria-label="后退"]')).toBeNull();
    expect(document.querySelector('button[aria-label="前进"]')).toBeNull();
    await clickAndFlush(document.querySelector('button[aria-label="刷新"]'));
    expect(model.navigateTab).toHaveBeenLastCalledWith('a', 'https://a.example/', 'proxy');
    expect(post).not.toHaveBeenCalled();
    expect(document.querySelector('iframe[data-tab-id="a"]')).not.toBe(frame);
  });

  it('shows a top progress bar and changes Refresh into Stop while loading', async () => {
    await render(browser({ navigateTab: vi.fn(() => new Promise(() => {})) }));
    const frame = document.querySelector('iframe[data-tab-id="a"]');
    const overlay = document.querySelector('.browser-page-loading');
    const progress = document.querySelector('.browser-page-progress');
    const progressRule = styles.match(/\.browser-page-progress\s*\{([^}]*)\}/)?.[1] || '';
    const proxyProgressRule = styles.match(/\.browser-pane\.proxy \.browser-page-progress\s*\{([^}]*)\}/)?.[1] || '';
    const proxyProgressFillRule = styles.match(/\.browser-pane\.proxy \.browser-page-progress::after\s*\{([^}]*)\}/)?.[1] || '';
    expect(overlay).not.toBeNull();
    expect(document.querySelector('.browser-loading-hud')).toBeNull();
    expect(progress).not.toBeNull();
    expect(progress.getAttribute('role')).toBe('progressbar');
    expect(progressRule).toMatch(/height:\s*3px/);
    expect(proxyProgressRule).toMatch(/background:\s*rgba\(217,130,43/);
    expect(proxyProgressFillRule).toMatch(/background:\s*#d9822b/);
    expect(frame.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('button[aria-label="停止加载"]')).not.toBeNull();

    act(() => frame.dispatchEvent(new Event('load')));
    expect(document.querySelector('.browser-page-loading')).toBeNull();
    expect(frame.hasAttribute('inert')).toBe(false);
    expect(document.querySelector('button[aria-label="刷新"]')).not.toBeNull();

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

  it('stops the current iframe navigation and keeps its mounted page state', async () => {
    let resolveNavigate;
    const model = browser({
      navigateTab: vi.fn(() => new Promise((resolve) => { resolveNavigate = resolve; })),
    });
    await render(model);
    const frame = document.querySelector('iframe[data-tab-id="a"]');
    const post = vi.spyOn(frame.contentWindow, 'postMessage');

    act(() => frame.dispatchEvent(new Event('load')));
    click(document.querySelector('button[aria-label="刷新"]'));
    click(document.querySelector('button[aria-label="停止加载"]'));

    expect(model.navigateTab).toHaveBeenCalledWith('a', 'https://a.example/', 'proxy');
    expect(post.mock.calls.map(([message]) => message.command)).toEqual(['stop']);
    expect(document.querySelector('iframe[data-tab-id="a"]')).toBe(frame);
    expect(frame.hasAttribute('inert')).toBe(false);
    expect(document.querySelector('.browser-page-loading')).toBeNull();

    await act(async () => {
      resolveNavigate(tabs[0]);
      await Promise.resolve();
    });
    expect(document.querySelector('iframe[data-tab-id="a"]')).toBe(frame);
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

  it('cold-loads only the active iframe, then retains visited iframes', async () => {
    const model = browser();
    await render(model);
    expect(document.querySelectorAll('.browser-frame')).toHaveLength(1);
    await render({ ...model, activeId: 'b' });
    const frames = [...document.querySelectorAll('.browser-frame')];
    expect(frames).toHaveLength(2);
    expect(frames[0].closest('.browser-pane').hidden).toBe(true);
    expect(frames[1].closest('.browser-pane').hidden).toBe(false);
    for (const frame of frames) {
      const sandbox = frame.getAttribute('sandbox').split(/\s+/);
      expect(sandbox).toEqual(expect.arrayContaining([
        'allow-scripts', 'allow-forms', 'allow-downloads', 'allow-modals', 'allow-popups', 'allow-same-origin',
      ]));
      expect(sandbox.some((value) => value.startsWith('allow-top-navigation'))).toBe(false);
    }
  });

  it('keeps iframe state mounted without reloading when tabs are switched', async () => {
    const model = browser({ switchTab: vi.fn().mockResolvedValue(true) });
    await render(model);
    await render({ ...model, activeId: 'b' });
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
    expect(postSecond).not.toHaveBeenCalled();
    expect(postFirst).not.toHaveBeenCalled();
  });

  it('does not reload a proxy page merely because its bridge script stays silent', async () => {
    vi.useFakeTimers();
    const model = browser();
    await render(model);
    const first = document.querySelector('iframe[data-tab-id="a"]');
    act(() => first.dispatchEvent(new Event('load')));
    act(() => vi.advanceTimersByTime(30_000));
    expect(model.recoverBinding).not.toHaveBeenCalled();

    await render({ ...model, activeId: 'b' });
    await render(model);
    expect(model.recoverBinding).not.toHaveBeenCalled();
  });

  it('does not reload either tab when switch promises finish out of order', async () => {
    let resolveA;
    let resolveB;
    const switchTab = vi.fn((id) => new Promise((resolve) => {
      if (id === 'a') resolveA = resolve;
      if (id === 'b') resolveB = resolve;
    }));
    const model = browser({ switchTab });
    await render(model);
    await render({ ...model, activeId: 'b' });
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

    expect(postFirst).not.toHaveBeenCalled();
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
    await render({ ...model, activeId: 'b' });
    const frame = document.querySelector('iframe[data-tab-id="b"]');

    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { source: 'handmux-browser', channel: 'shared', type: 'title', url: 'https://b.example/next', title: 'Beta Next' },
    })));

    expect(model.updateTabMeta).toHaveBeenCalledWith('b', { url: 'https://b.example/next', title: 'Beta Next' });
  });

  it('lets page-driven cross-origin navigation finish natively without replaying it', async () => {
    const model = browser();
    await render(model);
    const frame = document.querySelector('iframe[data-tab-id="a"]');

    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { source: 'handmux-browser', channel: 'ca', type: 'navigate', url: 'https://other.example/path', title: '' },
    })));

    expect(model.navigateTab).not.toHaveBeenCalled();
    expect(model.updateTabMeta).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: { source: 'handmux-browser', channel: 'ca', type: 'load', url: 'https://other.example/path', title: 'Other' },
    })));

    expect(model.navigateTab).not.toHaveBeenCalled();
    expect(model.updateTabMeta).toHaveBeenCalledWith('a', {
      url: 'https://other.example/path',
      title: 'Other',
    });
  });

  it('does not intercept page-driven form navigation through the parent API', async () => {
    const model = browser();
    await render(model);
    const frame = document.querySelector('iframe[data-tab-id="a"]');
    const postMessage = vi.spyOn(frame.contentWindow, 'postMessage');

    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: {
        source: 'handmux-browser', channel: 'ca', type: 'prepare-form-navigation',
        url: 'https://sso.example/login', requestId: 'request-1',
      },
    })));

    expect(model.prepareFormNavigation).not.toHaveBeenCalled();
    expect(model.navigateTab).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('shows site Cookie cleanup only in a proxied webpage menu', async () => {
    const model = browser({
      persistProxyLogin: false,
      proxyLoginRetentionDays: 30,
    });
    await render(model);
    expect(document.querySelectorAll('.browser-nav > button')).toHaveLength(2);
    const menuButton = document.querySelector('button[aria-label="浏览器菜单"]');
    expect(menuButton.querySelector('svg')).not.toBeNull();
    expect(menuButton.textContent).toBe('');
    click(menuButton);
    const card = document.querySelector('.browser-options-card');
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('连接方式');
    expect(card.textContent).not.toContain('当前网页');
    expect(card.textContent).toContain('页面视图');
    expect(card.textContent).toContain('后台页签关闭');
    expect(card.textContent).toContain('清理本站代理 Cookie');
    expect(card.textContent).not.toContain('清理全部代理 Cookie');
    expect(card.textContent).not.toContain('代理登录持久化');
    expect(card.textContent).not.toContain('关闭内置浏览器');
    const cookieRow = card.querySelector('.browser-site-cookie-row');
    expect(cookieRow).not.toBeNull();
    expect(cookieRow.querySelector('strong')).toBeNull();
    expect([...cookieRow.querySelectorAll('button')].map((node) => node.textContent)).toEqual([
      '清理本站代理 Cookie', '?',
    ]);

    const modeButtons = [...card.querySelectorAll('.browser-mode-segment button')];
    expect(modeButtons.map((node) => node.textContent)).toEqual(['手机直连', '经电脑代理']);
    const segmentRule = styles.match(/\.browser-mode-segment\s*\{([^}]*)\}/)?.[1] || '';
    expect(segmentRule).toMatch(/min-height:\s*44px/);
    click(modeButtons[0]);
    expect(model.navigateTab).toHaveBeenCalledWith('a', 'https://a.example/', 'direct');

    const viewButtons = [...card.querySelectorAll('.browser-view-segment button')];
    expect(viewButtons.map((node) => node.getAttribute('aria-label'))).toEqual(['手机视图', '电脑视图']);
    click(viewButtons[1]);
    expect(viewButtons[1].getAttribute('aria-pressed')).toBe('true');

    click(card.querySelector('.browser-close-trigger'));
    const closeChoices = [...card.querySelectorAll('.browser-time-option')];
    expect(closeChoices.map((node) => node.textContent)).toEqual(['10 分钟', '30 分钟', '60 分钟', '120 分钟']);
    click(closeChoices[1]);
    expect(model.setCloseAfter).toHaveBeenCalledWith(30);

    click(card.querySelector('.browser-options-help'));
    expect(document.querySelector('.browser-profile-confirm').textContent).toContain('手机直连 Cookie 不受影响');
    click(document.querySelector('.browser-profile-confirm button'));
    click([...card.querySelectorAll('button')].find((node) => node.textContent === '清理本站代理 Cookie'));
    expect(document.querySelector('.browser-profile-confirm').textContent).toContain('父域 Cookie');
    click([...document.querySelectorAll('.browser-profile-confirm button')]
      .find((node) => node.textContent === '确认'));
    expect(model.clearProxyLogin).toHaveBeenCalledWith('https://a.example');
  });

  it('keeps proxy persistence and clear-all controls only in the Home menu', async () => {
    const model = browser({
      historyActive: true,
      activeId: null,
      persistProxyLogin: false,
      proxyLoginRetentionDays: 30,
    });
    await render(model);
    click(document.querySelector('button[aria-label="浏览器菜单"]'));
    const card = document.querySelector('.browser-options-card');

    expect(card.textContent).toContain('在电脑上持久化保存代理 Cookie');
    expect(card.textContent).toContain('清理全部代理 Cookie');
    expect(card.textContent).toContain('关于内置浏览器');
    expect(card.textContent).not.toContain('清理本站代理 Cookie');
    expect(card.textContent).not.toContain('关闭内置浏览器');

    click([...card.querySelectorAll('button')].find((node) => node.textContent === '关于内置浏览器'));
    const about = document.querySelector('.browser-profile-confirm');
    expect(about.textContent).toContain('手机直连');
    expect(about.textContent).toContain('经电脑代理');
    expect(about.textContent).toContain('按当前设备隔离');
    expect([...about.querySelectorAll('button')].map((node) => node.textContent)).toEqual(['好的']);
    click(about.querySelector('button'));

    const persistence = card.querySelector('.browser-profile-persist');
    expect(persistence).not.toBeNull();
    expect(persistence.textContent).toContain('在电脑上持久化保存代理 Cookie');
    expect(card.querySelector('.browser-retention')).toBeNull();
    expect(card.querySelector('.browser-profile-retention-trigger')).toBeNull();
    click(persistence.querySelector('input'));
    expect(model.setProxyLoginPolicy).toHaveBeenCalledWith({ persist: true, retentionDays: null });

    click(card.querySelector('.browser-options-help'));
    expect(document.querySelector('.browser-profile-confirm p').textContent).toBe(
      '是否将代理 Cookie 加密保存在运行 Handmux 的电脑上，以便重启后保持登录状态。',
    );
    click(document.querySelector('.browser-profile-confirm button'));

    click([...card.querySelectorAll('button')].find((node) => node.textContent === '清理全部代理 Cookie'));
    expect(document.querySelector('.browser-profile-confirm').textContent).toContain('当前设备');
    click([...document.querySelectorAll('.browser-profile-confirm button')]
      .find((node) => node.textContent === '确认'));
    expect(model.clearProxyLogin).toHaveBeenCalledWith(null);
  });

  it('stops persistent proxy Cookie storage immediately without confirmation', async () => {
    const model = browser({
      historyActive: true,
      activeId: null,
      persistProxyLogin: true,
      proxyLoginRetentionDays: null,
    });
    await render(model);
    click(document.querySelector('button[aria-label="浏览器菜单"]'));
    click(document.querySelector('.browser-profile-persist input'));

    expect(model.setProxyLoginPolicy).toHaveBeenCalledWith({ persist: false, retentionDays: null });
    expect(document.querySelector('.browser-profile-confirm')).toBeNull();
  });

  it('lets a new page choose its connection mode before opening the address', async () => {
    const model = browser({ historyActive: true });
    await render(model);
    click(document.querySelector('button[aria-label="浏览器菜单"]'));

    const modeButtons = [...document.querySelectorAll('.browser-mode-segment button')];
    expect(modeButtons.map((node) => node.disabled)).toEqual([false, false]);
    expect(modeButtons.map((node) => node.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(document.querySelector('.browser-address-mode.direct').textContent).toBe('直连');
    click(modeButtons[1]);
    expect(modeButtons.map((node) => node.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(document.querySelector('.browser-address-mode.proxy').textContent).toBe('代理');

    setInput(document.querySelector('.browser-address'), 'https://portal.example/');
    submit(document.querySelector('.browser-address-form'));
    expect(model.openUrl).toHaveBeenCalledWith('https://portal.example/', { mode: 'proxy' });
    expect(model.navigateTab).not.toHaveBeenCalled();
  });
});
