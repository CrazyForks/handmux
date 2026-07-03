import { describe, it, expect } from 'vitest';
import { isAllowedKey } from '../src/httpApi.js';

describe('isAllowedKey', () => {
  it('accepts the named tmux keys the keyboard uses', () => {
    for (const k of ['Up', 'Down', 'Left', 'Right', 'Space', 'Enter', 'Escape',
      'Tab', 'BTab', 'BSpace', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(isAllowedKey(k)).toBe(true);
    }
  });

  it('accepts Ctrl/Alt + a single letter or digit (live-modifier combos)', () => {
    for (const k of ['C-c', 'C-d', 'C-z', 'C-l', 'C-r', 'C-o', 'C-e', 'C-a', 'C-w', 'C-u',
      'C-b', 'C-9', 'M-b', 'M-f', 'M-0']) {
      expect(isAllowedKey(k)).toBe(true);
    }
  });

  it('accepts Shift+arrow and Shift+Tab (BTab) for the Shift modifier', () => {
    for (const k of ['S-Up', 'S-Down', 'S-Left', 'S-Right', 'BTab']) {
      expect(isAllowedKey(k)).toBe(true);
    }
  });

  it('rejects anything outside the vocabulary or modifier shape', () => {
    for (const k of ['', 'rm -rf', 'C-', 'C-rf', 'C-C', 'X-a', 'C-;', 'Enter;ls',
      'Nope', undefined, null, 42, ['C-c']]) {
      expect(isAllowedKey(k)).toBe(false);
    }
  });
});
