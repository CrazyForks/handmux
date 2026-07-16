import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import ChatView from '../src/components/ChatView.jsx';
import * as api from '../src/api.js';

// This repo doesn't run vitest with `globals: true`, so testing-library's auto-cleanup (which hooks into
// a global afterEach) never registers — without this, DOM from one test leaks into the next.
afterEach(cleanup);

beforeEach(() => { vi.restoreAllMocks(); });

function mockTranscript(messages) {
  vi.spyOn(api, 'fetchTranscript').mockResolvedValue({ messages, hash: 'h', session: 's', hasMore: false, firstSeq: messages[0]?.k ?? 0 });
}

// Force the scroll container's geometry (jsdom reports 0 for all of these by default) so the near-bottom
// check and the jump-button/click-to-bottom logic have something real to compute against.
function setGeometry(el, { scrollTop, scrollHeight, clientHeight }) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  el.scrollTop = scrollTop;
}

describe('ChatView', () => {
  it('renders user text right and assistant text left', async () => {
    mockTranscript([
      { k: 0, i: 0, role: 'user', type: 'text', text: '帮我跑测试' },
      { k: 1, i: 1, role: 'assistant', type: 'text', text: '好的' },
    ]);
    const { container } = render(<ChatView pane="%0" kind="working" />);
    const user = await screen.findByText('帮我跑测试');
    await waitFor(() => expect(container.querySelector('.chat-them')).toBeTruthy());
    expect(user.className).toContain('chat-me');
    const them = container.querySelector('.chat-them');
    expect(them.className).toContain('chat-md');
    expect(them.textContent).toContain('好的');
  });

  it('collapses a tool call into a chip with a summary', async () => {
    mockTranscript([{ k: 0, i: 0, role: 'assistant', type: 'tool', tool: { name: 'Bash', input: { command: 'ls' }, result: 'a', isError: false } }]);
    render(<ChatView pane="%0" kind="working" />);
    // chip 文案含工具名/动作，不直接铺原始结果
    await screen.findByText(/Bash|运行|命令/);
    expect(screen.queryByText('a')).toBeNull(); // 结果默认折叠
  });

  it('tool head is collapsed one-line by default; tap expands full command + result', async () => {
    const longCmd = 'echo ' + 'x'.repeat(200);
    mockTranscript([{ k: 0, i: 0, role: 'assistant', type: 'tool', tool: { name: 'Bash', input: { command: longCmd }, result: 'the output', isError: false } }]);
    render(<ChatView pane="%0" kind="working" />);
    const head = await screen.findByRole('button', { name: new RegExp(longCmd.slice(0, 20)) });
    // collapsed: not marked "open" — CSS applies the single-line ellipsis truncation off this state
    expect(head.className).not.toContain('chat-tool-head-open');
    expect(screen.queryByText('the output')).toBeNull();
    fireEvent.click(head);
    expect(head.className).toContain('chat-tool-head-open');
    expect(head.textContent).toContain(longCmd);
    await screen.findByText('the output');
  });

  it('permission gate renders 允许/拒绝 and taps send the mapped keys', async () => {
    mockTranscript([{ k: 0, i: 0, role: 'assistant', type: 'tool', tool: { name: 'Bash', input: { command: 'ls' }, result: null, isError: false } }]);
    const keys = vi.spyOn(api, 'sendKeys').mockResolvedValue({ ok: true });
    render(<ChatView pane="%0" kind="permission" />);
    const allow = await screen.findByRole('button', { name: '允许' });
    fireEvent.click(allow);
    await waitFor(() => expect(keys).toHaveBeenCalledWith('%0', expect.arrayContaining(['Enter'])));
  });

  it('ExitPlanMode gate → shows switch-to-terminal hint, no buttons', async () => {
    mockTranscript([{ k: 0, i: 0, role: 'assistant', type: 'tool', tool: { name: 'ExitPlanMode', input: { plan: 'x' }, result: null, isError: false } }]);
    render(<ChatView pane="%0" kind="permission" />);
    await screen.findByText(/终端里处理|切.*终端/);
    expect(screen.queryByRole('button', { name: '允许' })).toBeNull();
  });

  it('renders markdown in an assistant text bubble — a table becomes a real <table>', async () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n';
    mockTranscript([{ k: 0, i: 0, role: 'assistant', type: 'text', text: md }]);
    const { container } = render(<ChatView pane="%0" kind="working" />);
    await waitFor(() => expect(container.querySelector('table')).toBeTruthy());
  });

  it('jump-to-bottom button is hidden near the bottom, appears when scrolled up, and clicking it snaps to bottom', async () => {
    mockTranscript([{ k: 0, i: 0, role: 'user', type: 'text', text: 'hi' }]);
    const { container } = render(<ChatView pane="%0" kind="working" />);
    await screen.findByText('hi');
    const el = container.querySelector('.chat-scroll');

    // Near the bottom (within NEAR_BOTTOM_PX) → no jump button.
    setGeometry(el, { scrollTop: 960, scrollHeight: 1000, clientHeight: 300 }); // 1000-960-300 = -260 < 40
    fireEvent.scroll(el);
    expect(screen.queryByRole('button', { name: '回到最新' })).toBeNull();

    // Scrolled well away from the bottom → button appears.
    setGeometry(el, { scrollTop: 0, scrollHeight: 1000, clientHeight: 300 }); // 1000-0-300 = 700 > 40
    fireEvent.scroll(el);
    const btn = await screen.findByRole('button', { name: '回到最新' });

    fireEvent.click(btn);
    expect(el.scrollTop).toBe(el.scrollHeight);
    expect(screen.queryByRole('button', { name: '回到最新' })).toBeNull();
  });

  it('a newly-arrived trailing user message forces the view back to the bottom, even if scrolled up', async () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(api, 'fetchTranscript');
      spy.mockResolvedValueOnce({ messages: [{ k: 0, i: 0, role: 'assistant', type: 'text', text: 'first' }], hash: 'h1', hasMore: false, firstSeq: 0 });
      const { container } = render(<ChatView pane="%0" kind="working" />);
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); }); // flush initial fetch

      const el = container.querySelector('.chat-scroll');
      setGeometry(el, { scrollTop: 0, scrollHeight: 1000, clientHeight: 300 }); // scrolled up, away from bottom
      fireEvent.scroll(el);

      // Next poll delivers a NEW trailing user message (k=1 > previous max k=0).
      spy.mockResolvedValueOnce({
        messages: [
          { k: 0, i: 0, role: 'assistant', type: 'text', text: 'first' },
          { k: 1, i: 1, role: 'user', type: 'text', text: 'second' },
        ],
        hash: 'h2', hasMore: false, firstSeq: 0,
      });
      // Growing the scrollHeight to simulate the new message actually adding content, so scrollTop===scrollHeight is meaningful.
      Object.defineProperty(el, 'scrollHeight', { value: 1400, configurable: true });
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });

      expect(el.scrollTop).toBe(1400);
    } finally {
      vi.useRealTimers();
    }
  });
});
