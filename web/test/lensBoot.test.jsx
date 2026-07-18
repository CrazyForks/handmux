import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import LensBoot from '../src/components/LensBoot.jsx';

// This repo doesn't run vitest with `globals: true`, so testing-library's auto-cleanup (which hooks into
// a global afterEach) never registers — without this, DOM from one test leaks into the next.
afterEach(cleanup);

describe('LensBoot (waiting state)', () => {
  it('renders the three-dot wave and the hint', () => {
    const { container } = render(<LensBoot hint="正在加载" />);
    expect(container.querySelectorAll('.lens-boot-dot').length).toBe(3);
    expect(screen.getByText('正在加载')).toBeTruthy();
  });

  it('the hint is optional (the wave alone still carries the wait)', () => {
    const { container } = render(<LensBoot />);
    expect(container.querySelectorAll('.lens-boot-dot').length).toBe(3);
    expect(container.querySelector('.lens-boot-hint')).toBeNull();
  });
});
