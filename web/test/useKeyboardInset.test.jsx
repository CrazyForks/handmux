import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useKeyboardInset } from '../src/hooks/useKeyboardInset.js';

function Probe() {
  const inset = useKeyboardInset();
  return `inset:${inset}`;
}

let container;
let root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
});

describe('useKeyboardInset', () => {
  it('returns 0 when visualViewport is unavailable', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Probe />));
    expect(container.textContent).toBe('inset:0');
  });
});
