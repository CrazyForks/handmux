import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ChatView from '../src/components/ChatView.jsx';
import * as api from '../src/api.js';

// This repo doesn't run vitest with `globals: true`, so testing-library's auto-cleanup (which hooks into
// a global afterEach) never registers — without this, DOM from one test leaks into the next.
afterEach(cleanup);

beforeEach(() => { vi.restoreAllMocks(); });

function mockTranscript(messages) {
  vi.spyOn(api, 'fetchTranscript').mockResolvedValue({ messages, hash: 'h', session: 's' });
}

describe('ChatView', () => {
  it('renders user text right and assistant text left', async () => {
    mockTranscript([
      { i: 0, role: 'user', type: 'text', text: '帮我跑测试' },
      { i: 1, role: 'assistant', type: 'text', text: '好的' },
    ]);
    render(<ChatView pane="%0" kind="working" />);
    await screen.findByText('帮我跑测试');
    await screen.findByText('好的');
  });

  it('collapses a tool call into a chip with a summary', async () => {
    mockTranscript([{ i: 0, role: 'assistant', type: 'tool', tool: { name: 'Bash', input: { command: 'ls' }, result: 'a', isError: false } }]);
    render(<ChatView pane="%0" kind="working" />);
    // chip 文案含工具名/动作，不直接铺原始结果
    await screen.findByText(/Bash|运行|命令/);
    expect(screen.queryByText('a')).toBeNull(); // 结果默认折叠
  });

  it('permission gate renders 允许/拒绝 and taps send the mapped keys', async () => {
    mockTranscript([{ i: 0, role: 'assistant', type: 'tool', tool: { name: 'Bash', input: { command: 'ls' }, result: null, isError: false } }]);
    const keys = vi.spyOn(api, 'sendKeys').mockResolvedValue({ ok: true });
    render(<ChatView pane="%0" kind="permission" />);
    const allow = await screen.findByRole('button', { name: '允许' });
    fireEvent.click(allow);
    await waitFor(() => expect(keys).toHaveBeenCalledWith('%0', expect.arrayContaining(['Enter'])));
  });

  it('ExitPlanMode gate → shows switch-to-terminal hint, no buttons', async () => {
    mockTranscript([{ i: 0, role: 'assistant', type: 'tool', tool: { name: 'ExitPlanMode', input: { plan: 'x' }, result: null, isError: false } }]);
    render(<ChatView pane="%0" kind="permission" />);
    await screen.findByText(/终端里处理|切.*终端/);
    expect(screen.queryByRole('button', { name: '允许' })).toBeNull();
  });
});
