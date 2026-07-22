import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import DocLinkPopover from '../src/components/DocLinkPopover.jsx';

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (props) => act(() => root.render(<DocLinkPopover {...props} />));
const click = (node) => act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));

const base = { path: '/home/u/口播稿-纯配音版.md', x: 100, y: 200, onOpen: vi.fn(), onClose: vi.fn() };

describe('DocLinkPopover', () => {
  it('offers direct and proxy choices and disables proxy with an explanation when unavailable', async () => {
    const onOpen = vi.fn();
    await render({
      path: 'https://example.com', x: 20, y: 20, onOpen, onClose: vi.fn(),
      modeChoices: true, proxyAvailable: false,
    });
    const buttons = [...container.querySelectorAll('.doclink-open')];
    expect(buttons.map((button) => button.textContent)).toEqual(['手机直连', '经电脑代理']);
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
    expect(container.textContent).toContain('当前服务器未开启浏览器代理');
    click(buttons[0]);
    expect(onOpen).toHaveBeenCalledWith('https://example.com', 'direct');
  });

  it('keeps both mode labels identifiable while only the pending mode is busy', async () => {
    const onOpen = vi.fn();
    await render({
      path: 'https://example.com', x: 20, y: 20, onOpen, onClose: vi.fn(),
      modeChoices: true, proxyAvailable: true, busy: true, busyMode: 'proxy', allowRepeat: true,
    });
    const [direct, proxy] = [...container.querySelectorAll('.doclink-open')];
    expect(direct.textContent).toBe('手机直连');
    expect(direct.getAttribute('aria-busy')).toBeNull();
    expect(direct.disabled).toBe(false);
    expect(proxy.textContent).toBe('经电脑代理 · 加载中…');
    expect(proxy.getAttribute('aria-busy')).toBe('true');
    expect(proxy.disabled).toBe(false);
    click(direct);
    expect(onOpen).toHaveBeenCalledWith('https://example.com', 'direct');
  });

  it('can keep a pending URL action repeatable so the latest confirmation replaces it', async () => {
    const onOpen = vi.fn();
    await render({ path: 'https://example.com', x: 20, y: 20, busy: true, allowRepeat: true, onOpen, onClose: vi.fn() });

    const button = document.querySelector('.doclink-open');
    expect(button.disabled).toBe(false);
    act(() => button.click());
    expect(onOpen).toHaveBeenCalledWith('https://example.com');
  });
  it('previews the basename and full path', async () => {
    await render({ ...base });
    expect(container.querySelector('.doclink-name').textContent).toContain('口播稿-纯配音版.md');
    expect(container.querySelector('.doclink-path').textContent).toBe('/home/u/口播稿-纯配音版.md');
  });

  it('disables repeated confirmation while opening', async () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    await render({ path: 'https://example.com', x: 10, y: 10, onOpen, onClose, busy: true });
    const button = container.querySelector('.doclink-open');
    expect(button.disabled).toBe(true);
    await click(button);
    expect(onOpen).not.toHaveBeenCalled();
    expect(container.querySelector('.doclink-cancel').disabled).toBe(false);
    await click(container.querySelector('.doclink-cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('opens only on 打开 (not on a stray render) and passes the path', async () => {
    const onOpen = vi.fn();
    await render({ ...base, onOpen });
    expect(onOpen).not.toHaveBeenCalled();
    await click(container.querySelector('.doclink-open'));
    expect(onOpen).toHaveBeenCalledWith('/home/u/口播稿-纯配音版.md');
  });
  it('dismisses on 取消 and on backdrop tap', async () => {
    const onClose = vi.fn();
    await render({ ...base, onClose });
    await click(container.querySelector('.doclink-cancel'));
    await click(container.querySelector('.doclink-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it('clamps its own measured box inside the viewport, sitting just below the tap', async () => {
    // jsdom reports offsetWidth/Height as 0 → centered on x, GAP(12) below y, both within bounds.
    await render({ ...base, x: 100, y: 200 });
    const pop = container.querySelector('.doclink-pop');
    expect(pop.style.left).toBe('100px');
    expect(pop.style.top).toBe('212px');
    expect(pop.style.visibility).toBe(''); // measured → shown, not the pre-measure hidden state
  });
});
