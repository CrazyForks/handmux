import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { softKeyboardUp, useKeyboardInset } from '../src/hooks/useKeyboardInset.js';

function Probe() {
  const inset = useKeyboardInset();
  return `inset:${inset}`;
}

let container;
let root;
const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  if ('visualViewport' in window) delete window.visualViewport;
  if (originalInnerHeight) Object.defineProperty(window, 'innerHeight', originalInnerHeight);
});

describe('useKeyboardInset', () => {
  it('returns 0 when visualViewport is unavailable', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Probe />));
    expect(container.textContent).toBe('inset:0');
  });

  it('keeps iOS keyboard presence independent from offsetTop focus scrolling', () => {
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    Object.defineProperty(window, 'visualViewport', {
      value: { height: 400, offsetTop: 368 },
      configurable: true,
    });
    expect(softKeyboardUp()).toBe(true);
  });

  it('uses the keyboard-down baseline when both mobile viewports shrink together', () => {
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true });
    Object.defineProperty(window, 'visualViewport', {
      value: { height: 400, offsetTop: 0 },
      configurable: true,
    });
    expect(softKeyboardUp()).toBe(false);    // old/current-only signal
    expect(softKeyboardUp(768)).toBe(true); // stable keyboard-down baseline
  });
});
