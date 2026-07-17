import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import LensSwitch from '../src/components/LensSwitch.jsx';

// This repo doesn't run vitest with `globals: true`, so testing-library's auto-cleanup (which hooks into
// a global afterEach) never registers — without this, DOM from one test leaks into the next.
afterEach(cleanup);

describe('LensSwitch (one-tap toggle)', () => {
  it('shows the current lens label; aria-label names the target action', () => {
    render(<LensSwitch value="terminal" onChange={() => {}} />);
    const btn = screen.getByRole('button', { name: '切换到对话模式' });
    expect(btn.textContent).toContain('终端');
  });

  it('tapping while on terminal switches to chat', () => {
    const onChange = vi.fn();
    render(<LensSwitch value="terminal" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith('chat');
  });

  it('tapping while on chat switches back to terminal', () => {
    const onChange = vi.fn();
    render(<LensSwitch value="chat" onChange={onChange} />);
    const btn = screen.getByRole('button', { name: '切换到终端模式' });
    expect(btn.textContent).toContain('对话');
    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith('terminal');
  });
});
