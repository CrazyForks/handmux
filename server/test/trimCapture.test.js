import { describe, it, expect } from 'vitest';
import { capTrailingBlankRows, MAX_TRAILING_BLANK } from '../src/trimCapture.js';

describe('capTrailingBlankRows', () => {
  it('caps a long run of trailing blank rows down to max (keeps one)', () => {
    // 1 content row + 5 trailing blank rows (capture-pane ends every row with \n)
    expect(capTrailingBlankRows('prompt\n\n\n\n\n\n', 1)).toBe('prompt\n\n');
  });

  it('leaves a capture with no trailing blanks untouched', () => {
    expect(capTrailingBlankRows('a\nb\nc\n', 1)).toBe('a\nb\nc\n');
  });

  it('leaves a trailing run already within max untouched', () => {
    expect(capTrailingBlankRows('a\n\n', 1)).toBe('a\n\n');
  });

  it('treats whitespace-only rows as blank but NOT rows carrying SGR (a shaded/padded row stays)', () => {
    // a, a shaded full-width pad row (has \x1b → kept), then 3 empty rows → capped to 1
    expect(capTrailingBlankRows('a\n\x1b[41m   \x1b[0m\n\n\n\n', 1)).toBe('a\n\x1b[41m   \x1b[0m\n\n');
  });

  it('handles an all-blank capture by keeping at most max rows', () => {
    expect(capTrailingBlankRows('\n\n\n\n', 2)).toBe('\n\n');
  });

  it('preserves the trailing-newline shape capture-pane produces (so prepareSeed still drops one)', () => {
    const out = capTrailingBlankRows('x\n\n\n\n', 1);
    expect(out.endsWith('\n')).toBe(true);
    expect(out).toBe('x\n\n');
  });

  it('defaults to MAX_TRAILING_BLANK when no max is given', () => {
    // content + (MAX+2) blank rows → capped down to MAX (robust to the constant's value)
    const input = 'p\n' + '\n'.repeat(MAX_TRAILING_BLANK + 2);
    expect(capTrailingBlankRows(input)).toBe('p\n' + '\n'.repeat(MAX_TRAILING_BLANK));
  });
});
