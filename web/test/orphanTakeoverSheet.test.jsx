import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/api.js', () => ({ getSessions: vi.fn(async () => [{ id: '$1', name: 'jly' }, { id: '$2', name: 'work' }]) }));

import OrphanTakeoverSheet from '../src/components/OrphanTakeoverSheet.jsx';

let container; let root;
beforeEach(() => { localStorage.clear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const orphan = { pid: 100, cwd: '/u/proj', cwdLabel: 'proj', sessionId: 's-1', snippet: 'resume me', state: 'idle' };
const render = async (props) => { await act(async () => { root.render(<OrphanTakeoverSheet open orphan={orphan} onConfirm={vi.fn()} onClose={vi.fn()} {...props} />); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

describe('OrphanTakeoverSheet', () => {
  it('defaults to new session + kill on, lists existing sessions as targets', async () => {
    await render({});
    const targets = [...container.querySelectorAll('.orphan-targets:not(.orphan-kill) .fontbtn')];
    expect(targets.map((b) => b.textContent)).toEqual(['新建会话', 'jly', 'work']);
    expect(targets[0].getAttribute('aria-pressed')).toBe('true'); // 新建 selected
    const kill = [...container.querySelectorAll('.orphan-kill .fontbtn')];
    expect(kill[0].getAttribute('aria-pressed')).toBe('true');  // 结束 (recommended) selected
    expect(kill[1].getAttribute('aria-pressed')).toBe('false'); // 保留
    expect(container.querySelector('.orphan-kill .orphan-reco').textContent).toBe('推荐');
  });

  it('confirms with new-session target + kill by default', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    await render({ onConfirm });
    await click(container.querySelector('.bind-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({ target: { mode: 'new' }, kill: true });
  });

  it('confirms into an existing session with kill toggled off', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    await render({ onConfirm });
    const targets = [...container.querySelectorAll('.orphan-targets:not(.orphan-kill) .fontbtn')];
    await click(targets[1]); // 'jly' → $1
    await click([...container.querySelectorAll('.orphan-kill .fontbtn')][1]); // 保留 → kill off
    await click(container.querySelector('.bind-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({ target: { mode: 'window', session: '$1' }, kill: false });
    expect(localStorage.getItem('tw_orphan_kill')).toBe('0'); // choice remembered
  });

  it('surfaces a takeover failure and re-enables the confirm button', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error('gone')));
    await render({ onConfirm });
    await click(container.querySelector('.bind-confirm'));
    expect(container.querySelector('.bind-error')).not.toBeNull();
    expect(container.querySelector('.bind-confirm').disabled).toBe(false);
  });
});
