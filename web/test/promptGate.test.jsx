import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../src/api.js', () => ({
  sendText: vi.fn(async () => ({ ok: true })),
  sendKeys: vi.fn(async () => ({ ok: true })),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

import PromptGate from '../src/components/PromptGate.jsx';
import { sendText, sendKeys } from '../src/api.js';

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const askPrompt = {
  kind: 'question',
  title: '你喜欢哪个?',
  options: [
    { n: 1, label: '红色', description: '热情' },
    { n: 2, label: '蓝色', description: '沉稳' },
  ],
  cursor: 1,
};

describe('PromptGate', () => {
  it('renders the scraped options with descriptions and defaults the selection to the cursor', () => {
    render(<PromptGate pane="%1" prompt={askPrompt} />);
    expect(screen.getByText('你喜欢哪个?')).toBeTruthy();
    expect(screen.getByText('热情')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /红色/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /蓝色/ }).getAttribute('aria-checked')).toBe('false');
  });

  it('确认 sends the SELECTED option digit (no Enter) — the menu hotkey', async () => {
    const onAct = vi.fn();
    render(<PromptGate pane="%1" prompt={askPrompt} onAct={onAct} />);
    fireEvent.click(screen.getByRole('radio', { name: /蓝色/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await Promise.resolve();
    expect(sendText).toHaveBeenCalledWith('%1', '2', false); // digit 2, no Enter
    expect(onAct).toHaveBeenCalled();
  });

  it('取消 sends Escape', async () => {
    render(<PromptGate pane="%1" prompt={askPrompt} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await Promise.resolve();
    expect(sendKeys).toHaveBeenCalledWith('%1', ['Escape']);
  });

  it('shows "第 i/N 题" progress for a multi-question step', () => {
    render(<PromptGate pane="%1" prompt={{ ...askPrompt, multi: true, step: 2, total: 3 }} />);
    expect(screen.getByText('第 2/3 题')).toBeTruthy();
  });

  it('the review screen renders 提交/取消 and 提交 sends the "Submit answers" digit', async () => {
    const review = {
      kind: 'question', title: 'review', submit: true, multi: true, step: 2, total: 2,
      options: [{ n: 1, label: 'Submit answers', description: '' }, { n: 2, label: 'Cancel', description: '' }],
    };
    render(<PromptGate pane="%1" prompt={review} />);
    expect(screen.queryByRole('radio')).toBeNull(); // not a radio list — a plain confirm
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await Promise.resolve();
    expect(sendText).toHaveBeenCalledWith('%1', '1', false);
  });
});
