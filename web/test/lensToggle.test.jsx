import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import LensSwitch from '../src/components/LensSwitch.jsx';

// This repo doesn't run vitest with `globals: true`, so testing-library's auto-cleanup (which hooks into
// a global afterEach) never registers — without this, DOM from one test leaks into the next.
afterEach(cleanup);

describe('LensSwitch', () => {
  it('renders 终端 left / 对话 right, reports the chosen lens', () => {
    const onChange = vi.fn();
    render(<LensSwitch value="terminal" onChange={onChange} />);
    const btns = screen.getAllByRole('button');
    expect(btns.map((b) => b.textContent)).toEqual(['终端', '对话']); // 终端在左
    fireEvent.click(screen.getByRole('button', { name: '对话' }));
    expect(onChange).toHaveBeenCalledWith('chat');
  });

  it('marks the active segment with aria-pressed', () => {
    render(<LensSwitch value="chat" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '对话' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '终端' }).getAttribute('aria-pressed')).toBe('false');
  });
});
