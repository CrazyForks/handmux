import { describe, it, expect } from 'vitest';
import { keyboardSwipeAction, shouldKeepKeyboard, rubberBand } from '../src/dockKeyboard.js';

describe('rubberBand', () => {
  it('is 1:1-ish for small pulls', () => {
    expect(rubberBand(4, 24)).toBeCloseTo(4, 0); // near-linear near 0
  });
  it('resists and asymptotes near the limit — never overshoots max', () => {
    expect(rubberBand(200, 24)).toBeLessThan(24);
    expect(rubberBand(200, 24)).toBeGreaterThan(23);
    expect(Math.abs(rubberBand(1e6, 24))).toBeLessThanOrEqual(24);
  });
  it('is symmetric and zero at rest', () => {
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(-30, 24)).toBeCloseTo(-rubberBand(30, 24), 6);
  });
});

describe('keyboardSwipeAction', () => {
  it('a vertical drag UP past the threshold shows the keyboard', () => {
    expect(keyboardSwipeAction(2, -40)).toBe('show');
  });
  it('a vertical drag DOWN past the threshold hides the keyboard', () => {
    expect(keyboardSwipeAction(-3, 40)).toBe('hide');
  });
  it('a horizontal-dominant drag is not a keyboard gesture (page swipe owns it)', () => {
    expect(keyboardSwipeAction(50, -40)).toBeNull(); // |dx| >= |dy|
  });
  it('a too-short vertical drag does not commit', () => {
    expect(keyboardSwipeAction(0, -10)).toBeNull();
    expect(keyboardSwipeAction(0, 10)).toBeNull();
  });
  it('respects a custom threshold', () => {
    expect(keyboardSwipeAction(0, -30, 50)).toBeNull();
    expect(keyboardSwipeAction(0, -60, 50)).toBe('show');
  });
});

describe('shouldKeepKeyboard', () => {
  const el = (tag, className = '') => {
    const n = { tagName: tag, closest: (sel) => (className.split(' ').includes(sel.slice(1)) ? n : null) };
    return n;
  };
  it('keeps focus when a text input holds it (command capture)', () => {
    expect(shouldKeepKeyboard(el('INPUT'))).toBe(true);
  });
  it('keeps focus when the chat composer (textarea) holds it', () => {
    expect(shouldKeepKeyboard(el('TEXTAREA'))).toBe(true);
  });
  it('does NOT pin on xterm\'s own hidden helper textarea', () => {
    expect(shouldKeepKeyboard(el('TEXTAREA', 'xterm'))).toBe(false);
  });
  it('does NOT pin on a non-input element or nothing', () => {
    expect(shouldKeepKeyboard(el('DIV'))).toBe(false);
    expect(shouldKeepKeyboard(null)).toBe(false);
  });
});
