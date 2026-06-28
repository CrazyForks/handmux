import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import CommandPanel from '../src/components/CommandPanel.jsx';

let container;
let root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = (props) => act(() => root.render(<CommandPanel {...props} />));
const click = (node) => act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const base = {
  open: true, recent: [], favorites: [],
  onPick: vi.fn(), onToggleFav: vi.fn(), onRemoveRecent: vi.fn(), onClose: vi.fn(),
};

describe('CommandPanel', () => {
  it('renders nothing when closed', () => {
    render({ ...base, open: false });
    expect(container.querySelector('.cmd-panel')).toBe(null);
  });

  it('renders favorites then recent in two labelled sections', () => {
    render({ ...base, favorites: ['npm test'], recent: ['ls -la'] });
    expect([...container.querySelectorAll('.cmd-section-name')].map((n) => n.textContent)).toEqual(['常用', '最近']);
    expect([...container.querySelectorAll('.cmd-scope')].map((n) => n.textContent)).toEqual(['全局 · 所有会话', '仅本会话']);
    expect([...container.querySelectorAll('.cmd-text')].map((n) => n.textContent)).toEqual(['npm test', 'ls -la']);
  });

  it('tapping a row fills via onPick', () => {
    const onPick = vi.fn();
    render({ ...base, recent: ['ls -la'], onPick });
    click(container.querySelector('.cmd-text'));
    expect(onPick).toHaveBeenCalledWith('ls -la');
  });

  it('shows a filled star for a recent item that is already a favorite, and toggles it', () => {
    const onToggleFav = vi.fn();
    render({ ...base, recent: ['npm test'], favorites: ['npm test'], onToggleFav });
    const recentRow = container.querySelectorAll('.cmd-row')[1]; // [0]=fav row, [1]=recent row
    const star = recentRow.querySelector('.cmd-star');
    expect(star.textContent).toBe('★'); // already favorite → filled
    click(star);
    expect(onToggleFav).toHaveBeenCalledWith('npm test');
  });

  it('✕ on a recent row removes it', () => {
    const onRemoveRecent = vi.fn();
    render({ ...base, recent: ['ls -la'], onRemoveRecent });
    click(container.querySelector('.cmd-del'));
    expect(onRemoveRecent).toHaveBeenCalledWith('ls -la');
  });
});
