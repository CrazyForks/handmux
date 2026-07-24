// web/test/settingsPreview.test.jsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/push.js', () => ({
  notifyEnabled: () => false, enableNotifications: vi.fn(), disableNotifications: vi.fn(), pushSupported: () => false,
}));
vi.mock('../src/api.js', () => ({ fetchPaneCwd: vi.fn(async () => ({ cwd: '/home/u/proj' })) }));

import Settings from '../src/components/Settings.jsx';

let container, root;
const termRef = { current: { getFontSize: () => ({ size: 14, auto: false }) } };
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
const render = (props) => act(() => root.render(
  <Settings open onClose={() => {}} termRef={termRef}
    onColDec={()=>{}} onColInc={()=>{}} onColRestore={()=>{}} onOpenChangelog={()=>{}} changelogUnread={false}
    {...props} />));
const click = (n) => act(() => n.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('Settings preview section', () => {
  it('toggles the device-local browser feature from its default-off setting', async () => {
    const browser = {
      accessEnabled: false,
      proxyAvailable: false,
      defaultMode: 'direct',
      setEnabled: vi.fn(),
      setDefaultMode: vi.fn(),
    };
    await render({ browser });
    const toggle = container.querySelector('input[aria-describedby="browser-enabled-hint"]');
    expect(toggle.checked).toBe(false);
    expect(container.textContent).toContain('启用内置浏览器');
    expect(container.textContent).toContain('标签页仅属于当前设备');
    click(toggle);
    expect(browser.setEnabled).toHaveBeenCalledWith(true);
  });

  it('chooses the default browser mode and explains an unavailable proxy', async () => {
    const setDefaultMode = vi.fn();
    await render({ browserDefaultMode: 'direct', browserProxyAvailable: false, onBrowserDefaultMode: setDefaultMode });
    const direct = [...container.querySelectorAll('button')].find((button) => button.textContent === '手机直连');
    const proxy = [...container.querySelectorAll('button')].find((button) => button.textContent === '经电脑代理');
    expect(direct.disabled).toBe(false);
    expect(direct.getAttribute('aria-pressed')).toBe('true');
    expect(proxy.disabled).toBe(true);
    expect(container.textContent).toContain('当前服务器未开启浏览器代理');
    expect(proxy.getAttribute('aria-describedby')).toBe('browser-proxy-unavailable');
    expect(container.querySelector('#browser-proxy-unavailable').textContent).toContain('当前服务器未开启浏览器代理');
    expect(container.textContent).toContain('地址栏新页签');
    expect(container.textContent).toContain('没有保存打开方式的历史记录');
    expect(container.textContent).not.toContain('终端链接');
    click(direct);
    expect(setDefaultMode).toHaveBeenCalledWith('direct');
  });

  it('shows current-device profile controls only when proxy is available', async () => {
    const browser = {
      proxyAvailable: true,
      defaultMode: 'direct',
      persistProxyLogin: false,
      proxyLoginRetentionDays: 30,
      setDefaultMode: vi.fn(),
      setPersistProxyLogin: vi.fn(),
      setProxyLoginRetentionDays: vi.fn(),
      clearProxyLogin: vi.fn(),
    };
    await render({ browser });
    expect(container.textContent).toContain('持久保留代理登录状态');
    expect(container.textContent).toContain('清理全部代理登录状态');
    const retention = [...container.querySelectorAll('.browser-retention button')];
    expect(retention.map((node) => node.textContent)).toEqual(['1 天', '7 天', '30 天', '永不']);
    expect(retention[2].getAttribute('aria-pressed')).toBe('true');

    click(retention[1]);
    expect(browser.setProxyLoginRetentionDays).toHaveBeenCalledWith(7);
    click([...container.querySelectorAll('button')]
      .find((node) => node.textContent === '清理全部代理登录状态'));
    expect(document.querySelector('.browser-profile-confirm').textContent).toContain('当前设备');
    click([...document.querySelectorAll('.browser-profile-confirm button')]
      .find((node) => node.textContent === '确认'));
    expect(browser.clearProxyLogin).toHaveBeenCalledWith(null);

    await render({ browser: { ...browser, proxyAvailable: false } });
    expect(container.textContent).not.toContain('持久保留代理登录状态');
    expect(container.textContent).not.toContain('清理全部代理登录状态');
  });

  it('confirms before disabling persistent proxy login without clearing current tabs', async () => {
    const setPersistProxyLogin = vi.fn();
    const browser = {
      proxyAvailable: true, defaultMode: 'direct', persistProxyLogin: true,
      proxyLoginRetentionDays: 30, setDefaultMode: vi.fn(), setPersistProxyLogin,
      setProxyLoginRetentionDays: vi.fn(), clearProxyLogin: vi.fn(),
    };
    await render({ browser });
    click(container.querySelector('.browser-profile-persist input'));
    expect(document.querySelector('.browser-profile-confirm')).not.toBeNull();
    expect(setPersistProxyLogin).not.toHaveBeenCalled();
  });

  it('makes profile confirmation keyboard-modal and restores trigger focus', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const browser = {
      proxyAvailable: true, defaultMode: 'direct', persistProxyLogin: false,
      proxyLoginRetentionDays: 30, setDefaultMode: vi.fn(), setPersistProxyLogin: vi.fn(),
      setProxyLoginRetentionDays: vi.fn(), clearProxyLogin: vi.fn(),
    };
    await render({ browser });
    const trigger = [...container.querySelectorAll('button')]
      .find((node) => node.textContent === '清理全部代理登录状态');
    trigger.focus();
    click(trigger);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });

    const dialog = document.querySelector('.browser-profile-confirm');
    const [cancel, confirm] = dialog.querySelectorAll('button');
    expect(document.activeElement).toBe(cancel);
    expect(container.querySelector('.settings-card').hasAttribute('inert')).toBe(true);
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

  it('defaults to 不开启; picking 静态 reveals 选择目录启动 and opens the dir picker', async () => {
    await render({ activePreview: null, onStartPreview: vi.fn() }); // no pane → picker opens synchronously, seeds $HOME
    expect(container.textContent).toContain('不开启');
    expect(container.textContent).not.toContain('选择目录启动'); // off by default — no start control yet
    click([...container.querySelectorAll('.preview-seg button')].find((b) => b.textContent === '静态'));
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('选择目录启动'));
    expect(btn).toBeTruthy();
    click(btn);
    expect(document.querySelector('.dirpick-card')).toBeTruthy(); // DirPicker opened
  });
  it('shows 运行中 + countdown + 打开/续期/停止 when a preview is active', async () => {
    const onOpen = vi.fn(); const onRenew = vi.fn(); const onStop = vi.fn();
    await render({ activePreview: { name: 'main-3', kind: 'static', dir: '/home/u/site', expiresAt: Date.now() + 300_000 },
      onStartPreview: vi.fn(), onOpenPreview: onOpen, onRenew, onStop });
    expect(container.textContent).toContain('运行中');
    expect(container.querySelector('.live-dot')).toBeTruthy();
    expect(container.querySelector('.preview-remain-s').textContent).toMatch(/分钟$/); // minutes, no seconds
    const byText = (t) => [...container.querySelectorAll('button')].find((b) => b.textContent === t);
    click(byText('打开'));
    expect(onOpen).toHaveBeenCalled(); // opens the in-app preview sheet (no browser tab)
    click(byText('续期'));
    expect(onRenew).toHaveBeenCalled();
    // 停止 is two-tap (no nested modal): first tap reveals 确认停止, only that fires onStop.
    click(byText('停止'));
    expect(onStop).not.toHaveBeenCalled();
    click(byText('确认停止'));
    expect(onStop).toHaveBeenCalled();
  });

  it('offers only off/static preview without preview-domain or port controls', async () => {
    await render({ activePreview: null });
    expect(container.textContent).toContain('不开启');
    expect([...container.querySelectorAll('.preview-seg button')].some((b) => b.textContent === '动态')).toBe(false);
    expect(container.textContent).not.toContain('previewDomain');
    expect(container.querySelector('input[type="number"]')).toBeNull();
    click([...container.querySelectorAll('.preview-seg button')].find((b) => b.textContent === '静态'));
    expect(container.textContent).toContain('选择目录启动');
  });
});
