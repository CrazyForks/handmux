import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import Drawer from '../src/components/Drawer.jsx';

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const base = {
  open: true,
  bound: ['main', 'server'],
  onSelectSession: vi.fn(),
  onUnbind: vi.fn(),
  onBind: vi.fn(),
  onClose: vi.fn(),
  onLogout: vi.fn(),
};

const render = async (props) => {
  await act(async () => { root.render(<Drawer {...base} {...props} />); });
};

describe('Drawer (bound sessions)', () => {
  it('lists the locally bound session names', async () => {
    await render({ currentSessionName: 'main' });
    const names = [...container.querySelectorAll('.drawer-name')].map((n) => n.textContent);
    expect(names).toEqual(['main', 'server']);
  });

  it('shows the empty state when nothing is bound', async () => {
    await render({ bound: [], currentSessionName: null });
    expect(container.querySelector('.drawer-name')).toBeNull();
    expect(container.querySelector('.drawer-empty')).not.toBeNull();
  });

  it('highlights the current session', async () => {
    await render({ currentSessionName: 'server' });
    const rows = [...container.querySelectorAll('.drawer-row')];
    const server = rows.find((r) => r.textContent.includes('server'));
    const main = rows.find((r) => r.textContent.includes('main'));
    expect(server.className).toContain('active');
    expect(main.className).not.toContain('active');
  });

  it('clicking a name calls onSelectSession with that name', async () => {
    const onSelectSession = vi.fn();
    await render({ onSelectSession });
    const server = [...container.querySelectorAll('.drawer-name')].find((n) => n.textContent === 'server');
    await act(async () => { server.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onSelectSession).toHaveBeenCalledWith('server');
  });

  it('clicking ✕ unbinds without selecting', async () => {
    const onUnbind = vi.fn();
    const onSelectSession = vi.fn();
    await render({ onUnbind, onSelectSession });
    const row = [...container.querySelectorAll('.drawer-row')].find((r) => r.textContent.includes('main'));
    await act(async () => {
      row.querySelector('.drawer-unbind').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onUnbind).toHaveBeenCalledWith('main');
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it('the bind button opens the bind flow', async () => {
    const onBind = vi.fn();
    await render({ onBind });
    await act(async () => {
      container.querySelector('.drawer-bind').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onBind).toHaveBeenCalled();
  });
});
