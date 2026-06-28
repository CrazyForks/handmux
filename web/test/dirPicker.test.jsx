// web/test/dirPicker.test.jsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

// fetchDir echoes the requested path back so the confirm button reports the seeded dir.
vi.mock('../src/api.js', () => ({
  UnauthorizedError: class extends Error {},
  fetchDir: vi.fn(async (p) => {
    const path = p || '/home/u';
    return { path, home: '/home/u', parent: path === '/home/u' ? null : '/home/u', entries: [{ name: 'sub', type: 'dir' }] };
  }),
  downloadFile: vi.fn(async () => {}),
  uploadFile: vi.fn(async () => ({ name: 'x', size: 1 })),
}));

import DirPicker from '../src/components/DirPicker.jsx';

let container, root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

const render = (props) => act(() => root.render(<DirPicker onPick={vi.fn()} onClose={vi.fn()} {...props} />));
const settle = async () => { await act(async () => {}); await act(async () => {}); };

describe('DirPicker', () => {
  it('seeds the browser to seedCwd and confirms it', async () => {
    const onPick = vi.fn();
    await render({ open: true, seedCwd: '/home/u/proj', onPick });
    // fetchDir may not have '/home/u/proj' in the standard mock so it echoes p back as path
    await settle();
    container.querySelector('.browse-pick-confirm').click();
    expect(onPick).toHaveBeenCalledWith('/home/u/proj');
  });

  it('renders nothing when closed', async () => {
    await render({ open: false, seedCwd: null });
    expect(container.querySelector('.dirpick-card')).toBeNull();
  });

  it('renders the overlay card and title when open', async () => {
    await render({ open: true, seedCwd: null });
    await settle();
    expect(container.querySelector('.dirpick-card')).not.toBeNull();
    expect(container.querySelector('.settings-title').textContent).toBe('选择目录');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('clicking the backdrop calls onClose', async () => {
    const onClose = vi.fn();
    await render({ open: true, seedCwd: null, onClose });
    act(() => {
      container.querySelector('.settings-backdrop').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the close button calls onClose', async () => {
    const onClose = vi.fn();
    await render({ open: true, seedCwd: null, onClose });
    act(() => {
      container.querySelector('.settings-close').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('passes the keyboard inset to the card so it can shrink above the keyboard', async () => {
    await render({ open: true, seedCwd: null, inset: 320 });
    await settle();
    const card = container.querySelector('.dirpick-card');
    expect(card.style.getPropertyValue('--kb-inset')).toBe('320px');
  });

  it('re-seeding on reopen navigates to the new seedCwd', async () => {
    const onPick = vi.fn();
    // open with first seed
    await render({ open: true, seedCwd: '/home/u/proj', onPick });
    await settle();
    // close and reopen with a different seed
    await render({ open: false, seedCwd: '/home/u/other', onPick });
    await render({ open: true, seedCwd: '/home/u/other', onPick });
    await settle();
    container.querySelector('.browse-pick-confirm').click();
    expect(onPick).toHaveBeenCalledWith('/home/u/other');
  });
});
