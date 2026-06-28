// web/test/imageViewer.test.jsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ImageViewer from '../src/components/ImageViewer.jsx';

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (props) => act(() => root.render(<ImageViewer {...props} />));
const click = (n) => act(() => n.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const btn = (label) => container.querySelector(`.doc-image-zoom button[aria-label="${label}"]`);
const img = () => container.querySelector('img.doc-image');

describe('ImageViewer', () => {
  it('shows the failure message when there is no url', async () => {
    await render({ url: null, name: 'a.png' });
    expect(container.querySelector('.doc-image-msg')).toBeTruthy();
    expect(container.querySelector('img.doc-image')).toBeNull();
  });

  it('renders the image and a zoom pill (− disabled at 100%, scale 1)', async () => {
    await render({ url: 'blob:x', name: 'a.png' });
    expect(img().getAttribute('src')).toBe('blob:x');
    expect(img().style.transform).toContain('scale(1)');
    expect(btn('缩小').disabled).toBe(true);  // already fit-to-width
    expect(btn('放大').disabled).toBe(false);
    expect(container.querySelector('.doc-image-zoom-val').textContent).toBe('100%');
  });

  it('+ zooms the whole image (transform scale grows); − returns to fit and recenters', async () => {
    await render({ url: 'blob:x', name: 'a.png' });
    await click(btn('放大'));
    expect(img().style.transform).toContain('scale(1.5)');
    expect(container.querySelector('.doc-image-zoom-val').textContent).toBe('150%');
    expect(btn('缩小').disabled).toBe(false);
    await click(btn('缩小'));
    expect(img().style.transform).toBe('translate(0px, 0px) scale(1)'); // back to fit → centered
    expect(btn('缩小').disabled).toBe(true);
  });

  it('clamps zoom at the max (放大 disables, never exceeds 600%)', async () => {
    await render({ url: 'blob:x', name: 'a.png' });
    for (let i = 0; i < 8; i++) await click(btn('放大')); // 1.5^n would blow past MAX without the clamp
    expect(btn('放大').disabled).toBe(true);
    expect(container.querySelector('.doc-image-zoom-val').textContent).toBe('600%');
  });
});
