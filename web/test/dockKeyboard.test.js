import { describe, it, expect } from 'vitest';
import { keyboardSwipeAction, shouldKeepKeyboard, rubberBand } from '../src/dockKeyboard.js';

describe('rubberBand', () => {
  it('follows at slope c for small pulls', () => {
    expect(rubberBand(2, 44, 0.5)).toBeCloseTo(1, 1); // ≈ c*pull near zero
  });
  it('never reaches or overshoots max, however hard you pull', () => {
    expect(rubberBand(1e6, 44, 0.5)).toBeLessThan(44);
    expect(rubberBand(1e6, 44, 0.5)).toBeGreaterThan(43);
  });
  it('resistance grows toward the end — each further pull adds less travel, but never zero', () => {
    const a = rubberBand(50) - rubberBand(25);   // early increment
    const b = rubberBand(200) - rubberBand(175); // late increment (same 25px of finger)
    expect(b).toBeLessThan(a);   // it resists more the further out you are
    expect(b).toBeGreaterThan(0); // …but still keeps giving, never a dead stop
  });
  it('is symmetric and zero at rest', () => {
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(-30)).toBeCloseTo(-rubberBand(30), 6);
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
