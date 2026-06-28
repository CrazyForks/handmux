// web/test/previewSheet.test.jsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/api.js', () => ({
  previewUrl: (entry, domain) => {
    if (entry?.kind === 'dynamic') return `https://${entry.name}.${domain}/?token=t`;
    return `/preview/${entry?.name}/?token=t`;
  },
}));

import PreviewSheet from '../src/components/PreviewSheet.jsx';

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
const render = (props) => act(() => root.render(<PreviewSheet onMinimize={() => {}} onRenew={() => {}} onStop={() => {}} {...props} />));
const click = (n) => act(() => n.dispatchEvent(new MouseEvent('click', { bubbles: true })));
// PreviewSheet portals to document.body, so query there.
const inSheet = (sel) => document.querySelector(`.file-sheet ${sel}`);

describe('PreviewSheet', () => {
  it('is hidden (no .open) and renders no iframe before a preview exists', async () => {
    await render({ open: false, name: undefined });
    expect(document.querySelector('.file-sheet')).toBeTruthy();
    expect(document.querySelector('.file-sheet.open')).toBeNull();
    expect(document.querySelector('.preview-frame')).toBeNull();
  });

  it('shows status, a minutes countdown, the iframe, and a popover for renew/stop + minimize', async () => {
    const onRenew = vi.fn(); const onStop = vi.fn(); const onMin = vi.fn();
    await render({ open: true, name: 'main-3', kind: 'static', domain: null, expiresAt: Date.now() + 125_000, onRenew, onStop, onMinimize: onMin });
    expect(document.querySelector('.file-sheet.open')).toBeTruthy();
    expect(document.querySelector('.preview-state').textContent).toBe('静态预览');
    expect(document.querySelector('.preview-name').textContent).toBe('main-3');
    const remain = document.querySelector('.preview-remain');
    expect(remain.textContent).toMatch(/^\d+ 分钟$/); // minutes only, concise, no seconds
    expect(remain.textContent).not.toMatch(/:/);
    expect(inSheet('iframe.preview-frame').getAttribute('src')).toBe('/preview/main-3/?token=t');

    const byLabel = (l) => document.querySelector(`.file-sheet button[aria-label="${l}"]`);
    expect(byLabel('刷新')).toBeTruthy();        // refresh is icon-only
    click(byLabel('刷新'));                       // reloads the iframe — must not throw
    // 续期/停止 live in the time chip's popover now (not header icons).
    expect(byLabel('续期')).toBeNull();
    expect(byLabel('停止')).toBeNull();
    click(remain); // open the popover
    const popItem = (t) => [...document.querySelectorAll('.preview-pop-item')].find((b) => b.textContent.includes(t));
    click(popItem('续期'));
    expect(onRenew).toHaveBeenCalled();
    click(remain); // reopen
    click(popItem('停止预览'));
    expect(onStop).toHaveBeenCalled();
    click(byLabel('收起'));
    expect(onMin).toHaveBeenCalled();
  });

  it('toggles between 手机/电脑 view', async () => {
    await render({ open: true, name: 'foo', kind: 'static', domain: null, expiresAt: Date.now() + 300_000 });
    const byLabel = (l) => document.querySelector(`.file-sheet button[aria-label="${l}"]`);
    const toPc = byLabel('切换到电脑视图'); // defaults to mobile → button offers PC
    expect(toPc).toBeTruthy();
    click(toPc);
    expect(byLabel('切换到手机视图')).toBeTruthy(); // now PC → button offers switching back
  });

  it('static preview shows 静态预览 + the source dir, iframe at the /preview path', async () => {
    localStorage.setItem('tw_token', 'tok');
    await render({ open: true, name: 'foo', kind: 'static', dir: '/home/u/site', domain: null, expiresAt: Date.now() + 3_600_000 });
    expect(document.querySelector('.preview-state').textContent).toBe('静态预览');
    expect(document.querySelector('.preview-detail').textContent).toBe('/home/u/site');
    expect(document.querySelector('iframe.preview-frame').getAttribute('src')).toBe('/preview/foo/?token=t');
  });

  it('dynamic preview shows 动态预览 + :port, iframe at the wildcard subdomain', async () => {
    localStorage.setItem('tw_token', 'tok');
    await render({ open: true, name: 'app', kind: 'dynamic', port: 4705, domain: 'preview.example.com', expiresAt: Date.now() + 3_600_000 });
    expect(document.querySelector('.preview-state').textContent).toBe('动态预览');
    expect(document.querySelector('.preview-detail').textContent).toBe(':4705');
    expect(document.querySelector('iframe.preview-frame').getAttribute('src')).toBe('https://app.preview.example.com/?token=t');
  });
});
