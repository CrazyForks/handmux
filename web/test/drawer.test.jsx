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

  describe('未接管会话 (orphans)', () => {
    const orphans = [
      { pid: 100, cwd: '/u/idle', cwdLabel: 'idle', sessionId: 's-idle', state: 'idle', snippet: 'resume me' },
      { pid: 200, cwd: '/u/busy', cwdLabel: 'busy', sessionId: 's-busy', state: 'busy', snippet: 'running' },
      { pid: 300, cwd: '/u/nohist', cwdLabel: 'nohist', sessionId: null, state: 'idle', snippet: '' },
    ];

    it('no section when there are no orphans', async () => {
      await render({ orphans: [] });
      expect(container.querySelector('.drawer-orphans')).toBeNull();
    });

    it('shows a collapsed count; expands to takeover rows', async () => {
      await render({ orphans });
      const head = container.querySelector('.drawer-orphans-head');
      expect(head.textContent).toContain('3');
      expect(container.querySelector('.drawer-orphan-btn')).toBeNull(); // collapsed
      await act(async () => { head.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect([...container.querySelectorAll('.drawer-orphan-btn')]).toHaveLength(3);
    });

    it('接管 fires onTakeoverRequest for idle; disabled for busy / no history', async () => {
      const onTakeoverRequest = vi.fn();
      await render({ orphans, onTakeoverRequest });
      await act(async () => { container.querySelector('.drawer-orphans-head').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      const btns = [...container.querySelectorAll('.drawer-orphan-btn')];
      expect(btns[0].disabled).toBe(false); // idle + session
      expect(btns[1].disabled).toBe(true);  // busy
      expect(btns[2].disabled).toBe(true);  // no resumable history
      expect(btns[2].getAttribute('title')).toBe('无可续接的历史');
      await act(async () => { btns[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(onTakeoverRequest).toHaveBeenCalledWith(orphans[0]);
    });
  });
});
