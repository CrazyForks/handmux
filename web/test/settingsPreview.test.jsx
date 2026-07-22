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
const nativeSetValue = (input, v) => Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, v);

describe('Settings preview section', () => {
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

  it('shows an inline error and stays open when a dynamic start fails (port not listening)', async () => {
    const onStartDynamicPreview = vi.fn(async () => { throw new Error('port not listening'); });
    const onClose = vi.fn();
    await render({ activePreview: null, dynamicEnabled: true, onStartDynamicPreview, onClose });
    await act(() => { [...container.querySelectorAll('.preview-seg button')].find((b) => b.textContent === '动态').click(); });
    const input = container.querySelector('input[type="number"]');
    await act(() => { nativeSetValue(input, '3000'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent === '启动').click(); });
    await act(async () => {}); // flush the rejected promise + state update
    expect(container.textContent).toContain('端口 :3000 没有服务在监听');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a dynamic active preview labels 动态预览 and shows the port', async () => {
    await render({ activePreview: { name: 'app', kind: 'dynamic', port: 4705, expiresAt: Date.now() + 300_000 },
      onRenew: vi.fn(), onStop: vi.fn(), onOpenPreview: vi.fn() });
    expect(container.textContent).toContain('动态预览');
    expect(container.textContent).toContain(':4705');
  });

  it('offers no 动态 tab when dynamic is disabled, but explains how to enable it; 静态 reveals the dir start', async () => {
    await render({ activePreview: null, dynamicEnabled: false });
    expect(container.textContent).toContain('不开启');
    // no Dynamic tab to start one with…
    expect([...container.querySelectorAll('.preview-seg button')].some((b) => b.textContent === '动态')).toBe(false);
    // …but a non-blocking hint explains why it's missing and how to turn it on (so an ACM user knows they can)
    expect(container.textContent).toContain('previewDomain');
    click([...container.querySelectorAll('.preview-seg button')].find((b) => b.textContent === '静态'));
    expect(container.textContent).toContain('选择目录启动');
  });

  it('shows 不开启/静态/动态 segments when dynamic is enabled', async () => {
    await render({ activePreview: null, dynamicEnabled: true });
    const segs = [...container.querySelectorAll('.preview-seg button')].map((b) => b.textContent);
    expect(segs).toEqual(['不开启', '静态', '动态']);
  });

  it('starting a dynamic preview calls onStartDynamicPreview with the port number', async () => {
    const onStartDynamicPreview = vi.fn();
    await render({ activePreview: null, dynamicEnabled: true, onStartDynamicPreview });
    // switch to dynamic
    await act(() => { [...container.querySelectorAll('button')].find((b) => b.textContent === '动态').click(); });
    const input = container.querySelector('input[type="number"]');
    await act(() => { nativeSetValue(input, '3000'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => {
      [...container.querySelectorAll('button')].find((b) => b.textContent === '启动').click();
      await Promise.resolve();
    });
    expect(onStartDynamicPreview).toHaveBeenCalledWith(3000);
  });
});
