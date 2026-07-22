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
