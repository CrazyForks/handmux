import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import LensBoot from '../src/components/LensBoot.jsx';

// This repo doesn't run vitest with `globals: true`, so testing-library's auto-cleanup (which hooks into
// a global afterEach) never registers — without this, DOM from one test leaks into the next.
afterEach(cleanup);

describe('LensBoot (branded waiting state)', () => {
  it('renders the handmux wordmark, the three-dot wave, and the hint', () => {
    const { container } = render(<LensBoot hint="正在读取这段对话…" />);
    expect(container.querySelector('.lens-boot-word').textContent).toBe('handmux');
    expect(container.querySelectorAll('.lens-boot-dot').length).toBe(3);
    expect(screen.getByText('正在读取这段对话…')).toBeTruthy();
  });

  it('the hint is optional (wordmark + wave still carry the wait)', () => {
    const { container } = render(<LensBoot />);
    expect(container.querySelector('.lens-boot-word')).toBeTruthy();
    expect(container.querySelector('.lens-boot-hint')).toBeNull();
  });
});
