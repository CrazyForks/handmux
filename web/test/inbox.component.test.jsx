import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import Inbox from '../src/components/Inbox.jsx';

let container;
let root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const rows = [
  { pane: '%1', session: 'a', window: '@1', windowName: 'edit', view: 'needs', msg: '', ts: 100 },
  { pane: '%2', session: 'a', window: '@2', windowName: 'run', view: 'working', msg: 'build it', ts: 200 },
  { pane: '%3', session: 'b', window: '@9', windowName: 'log', view: 'done', msg: 'fin', ts: 80 },
];
const base = {
  rows, top: 'needs', open: false,
  onToggle: vi.fn(), onClose: vi.fn(), onSelectRow: vi.fn(), onMarkAllRead: vi.fn(),
};
const render = async (props) => { await act(async () => { root.render(<Inbox {...base} {...props} />); }); };

describe('Inbox v2', () => {
  it('shows a colour-coded priority dot; hidden when nothing active', async () => {
    await render({ top: 'needs' });
    expect(container.querySelector('.inbox-dot').className).toBe('inbox-dot needs');
    await render({ top: 'working' });
    expect(container.querySelector('.inbox-dot').className).toBe('inbox-dot working');
    await render({ top: null });
    expect(container.querySelector('.inbox-dot')).toBeNull();
  });
  it('panel closed until open', async () => {
    await render({ open: false });
    expect(container.querySelector('.inbox-panel')).toBeNull();
  });
  it('open groups by session and renders view chips', async () => {
    await render({ open: true });
    expect([...container.querySelectorAll('.inbox-group-title')].map((n) => n.textContent)).toEqual(['a', 'b']);
    const chips = [...container.querySelectorAll('.inbox-chip')].map((c) => [c.className, c.textContent]);
    expect(chips).toContainEqual(['inbox-chip needs', '需要你']);
    expect(chips).toContainEqual(['inbox-chip working', '进行中']);
    expect(chips).toContainEqual(['inbox-chip done', '已完成']);
  });
  it('clicking a row calls onSelectRow with that row', async () => {
    const onSelectRow = vi.fn();
    await render({ open: true, onSelectRow });
    await act(async () => { container.querySelector('.inbox-row').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onSelectRow).toHaveBeenCalledWith(rows[0]);
  });
  it('清除已完成 button (shown when a done row exists) calls onMarkAllRead', async () => {
    const onMarkAllRead = vi.fn();
    await render({ open: true, onMarkAllRead }); // default rows include a done row (%3)
    const btn = container.querySelector('.inbox-readall');
    expect(btn.textContent).toBe('清除已完成');
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onMarkAllRead).toHaveBeenCalled();
  });
  it('hides the 清除已完成 button when there is no done row (nothing to clear)', async () => {
    const noDone = rows.filter((r) => r.view !== 'done'); // only needs + working remain
    await render({ open: true, rows: noDone });
    expect(container.querySelector('.inbox-readall')).toBeNull();
  });
  it('empty state when no rows', async () => {
    await render({ open: true, rows: [] });
    expect(container.querySelector('.inbox-empty')).not.toBeNull();
  });
  it('renders the per-view tally in the panel header (进行中/已完成/需要你)', async () => {
    await render({ open: true }); // default rows: 1 needs, 1 working, 1 done
    const summary = container.querySelector('.inbox-head .inbox-summary');
    expect(summary).not.toBeNull(); // lives in the header, in line with the 收件箱 title
    expect(summary.textContent).toContain('进行中 1');
    expect(summary.textContent).toContain('已完成 1');
    expect(summary.textContent).toContain('需要你 1');
  });
  it('toggle fires onToggle', async () => {
    const onToggle = vi.fn();
    await render({ onToggle });
    await act(async () => { container.querySelector('.inbox-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onToggle).toHaveBeenCalled();
  });
  it('falls back to the window id when windowName is empty (tmux can return none)', async () => {
    const nameless = [{ pane: '%9', session: 'a', window: '@7', windowName: '', view: 'done', msg: '', ts: 1 }];
    await render({ open: true, rows: nameless });
    expect(container.querySelector('.inbox-loc').textContent).toBe('@7');
  });

  describe('orphan footer', () => {
    const orphans = [
      { pid: 100, cwd: '/u/idle', cwdLabel: 'idle', sessionId: 's-idle', state: 'idle', snippet: 'resume me', startedAt: 1, lastActivity: 1 },
      { pid: 200, cwd: '/u/busy', cwdLabel: 'busy', sessionId: 's-busy', state: 'busy', snippet: 'running', startedAt: 1, lastActivity: 1 },
      { pid: 300, cwd: '/u/nohist', cwdLabel: 'nohist', sessionId: null, state: 'idle', snippet: '', startedAt: 1, lastActivity: 1 },
    ];

    it('hidden when no orphans; shown (collapsed) with a count when present', async () => {
      await render({ open: true, orphans: [] });
      expect(container.querySelector('.inbox-orphans')).toBeNull();
      await render({ open: true, orphans });
      expect(container.querySelector('.inbox-orphans-head').textContent).toContain('3');
      expect(container.querySelector('.inbox-orphans-body')).toBeNull(); // collapsed
    });

    it('shows the footer even when there are no tmux rows', async () => {
      await render({ open: true, rows: [], orphans });
      expect(container.querySelector('.inbox-empty')).toBeNull(); // footer replaces the empty state
      expect(container.querySelector('.inbox-orphans')).not.toBeNull();
    });

    it('expands to rows; 接管 fires onTakeoverRequest for idle, disabled for busy/no-history', async () => {
      const onTakeoverRequest = vi.fn();
      await render({ open: true, orphans, onTakeoverRequest });
      await act(async () => { container.querySelector('.inbox-orphans-head').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      const btns = [...container.querySelectorAll('.inbox-orphan-btn')];
      expect(btns).toHaveLength(3);
      expect(btns[0].disabled).toBe(false);         // idle + has session
      expect(btns[1].disabled).toBe(true);          // busy
      expect(btns[2].disabled).toBe(true);          // no resumable history
      expect(btns[2].textContent).toBe('无可续接的历史');
      await act(async () => { btns[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(onTakeoverRequest).toHaveBeenCalledWith(orphans[0]);
    });
  });
});
