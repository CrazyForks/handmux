import { describe, it, expect } from 'vitest';
import {
  SCROLL_COLS, KEY_LABELS, REPEAT_KEYS, keyAction,
} from '../src/keybarKeys.js';

describe('keybarKeys', () => {
  it('scroll strip starts with the inverted-T arrow cluster (Esc/Tab on the top corners)', () => {
    expect(SCROLL_COLS.slice(0, 3)).toEqual([
      ['esc', 'left'],
      ['up', 'down'],
      ['tab', 'right'],
    ]);
  });

  it('the control keys sit furthest right in the scroll strip (Shift+Tab/Ctrl+L then Ctrl+O/Ctrl+E)', () => {
    expect(SCROLL_COLS.slice(-2)).toEqual([['stab', 'ctrll'], ['ctrlo', 'ctrle']]);
  });

  it('scroll columns are two-key pairs and every key has a label', () => {
    for (const col of SCROLL_COLS) {
      expect(col).toHaveLength(2);
      for (const id of col) expect(typeof KEY_LABELS[id]).toBe('string');
    }
  });

  it('only arrows auto-repeat', () => {
    expect([...REPEAT_KEYS].sort()).toEqual(['down', 'left', 'right', 'up']);
  });

  it('maps named keys (Shift+Tab -> BTab, Ctrl+R/L, arrows)', () => {
    expect(keyAction('esc')).toEqual({ kind: 'key', name: 'Escape' });
    expect(keyAction('space')).toEqual({ kind: 'key', name: 'Space' });
    expect(keyAction('up')).toEqual({ kind: 'key', name: 'Up' });
    expect(keyAction('down')).toEqual({ kind: 'key', name: 'Down' });
    expect(keyAction('left')).toEqual({ kind: 'key', name: 'Left' });
    expect(keyAction('right')).toEqual({ kind: 'key', name: 'Right' });
    expect(keyAction('tab')).toEqual({ kind: 'key', name: 'Tab' });
    expect(keyAction('stab')).toEqual({ kind: 'key', name: 'BTab' });
    expect(keyAction('ctrlc')).toEqual({ kind: 'key', name: 'C-c' });
    expect(keyAction('ctrll')).toEqual({ kind: 'key', name: 'C-l' });
    expect(keyAction('ctrlo')).toEqual({ kind: 'key', name: 'C-o' });
    expect(keyAction('ctrle')).toEqual({ kind: 'key', name: 'C-e' });
  });

  it('maps literal-character keys, including the slash-command shortcuts', () => {
    expect(keyAction('slash')).toEqual({ kind: 'text', ch: '/' });
    expect(keyAction('at')).toEqual({ kind: 'text', ch: '@' });
    expect(keyAction('n1')).toEqual({ kind: 'text', ch: '1' });
    expect(keyAction('n2')).toEqual({ kind: 'text', ch: '2' });
    expect(keyAction('n3')).toEqual({ kind: 'text', ch: '3' });
    expect(keyAction('bang')).toEqual({ kind: 'text', ch: '!' });
    expect(keyAction('compact')).toEqual({ kind: 'text', ch: '/compact' });
    expect(keyAction('clear')).toEqual({ kind: 'text', ch: '/clear' });
    expect(keyAction('model')).toEqual({ kind: 'text', ch: '/model' });
    expect(keyAction('btw')).toEqual({ kind: 'text', ch: '/btw ' }); // trailing space, ready for the note
    expect(keyAction('effort')).toEqual({ kind: 'text', ch: '/effort' });
    expect(keyAction('plugin')).toEqual({ kind: 'text', ch: '/plugin' });
    expect(keyAction('loop')).toEqual({ kind: 'text', ch: '/loop ' }); // trailing space, ready for the command
    expect(keyAction('skill')).toEqual({ kind: 'text', ch: '/skill' });
  });

  it('returns null for an unknown id', () => {
    expect(keyAction('nope')).toBe(null);
  });
});
