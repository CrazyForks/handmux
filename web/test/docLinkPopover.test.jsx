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
  it('previews the basename and full path', async () => {
    await render({ ...base });
    expect(container.querySelector('.doclink-name').textContent).toContain('口播稿-纯配音版.md');
    expect(container.querySelector('.doclink-path').textContent).toBe('/home/u/口播稿-纯配音版.md');
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
