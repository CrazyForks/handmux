import { describe, it, expect } from 'vitest';
import {
  COMMAND_ROWS, CONTROL_KEYS, MODIFIERS, KEY_LABELS, REPEAT_KEYS, keyAction,
  MOD_OFF, MOD_ARMED, MOD_LOCKED, tapMod, modActive, consumeMods, withMods,
} from '../src/keybarKeys.js';

describe('command grid layout', () => {
  it('is a fixed 3×7 grid', () => {
    expect(COMMAND_ROWS).toHaveLength(3);
    for (const row of COMMAND_ROWS) expect(row).toHaveLength(7);
  });

  it('pins the corners: ⌨ top-left, ⌫ top-right, 常用 bottom-left; Enter at the middle-row right edge', () => {
    expect(COMMAND_ROWS[0][0]).toBe('kbd');
    expect(COMMAND_ROWS[0][6]).toBe('del');
    expect(COMMAND_ROWS[2][0]).toBe('fav');
    expect(COMMAND_ROWS[1][6]).toBe('enter');
  });

  it('places the arrows as an inverted-T at the bottom-right (▲ over ◀ ▼ ▶)', () => {
    expect(COMMAND_ROWS[1][5]).toBe('up');                         // ▲ above ▼
    expect(COMMAND_ROWS[2].slice(4)).toEqual(['left', 'down', 'right']); // ◀ ▼ ▶ on the bottom row
  });

  it('ctrl/shift/alt are the live modifiers; kbd/fav are controls', () => {
    expect(MODIFIERS).toEqual(['ctrl', 'shift', 'alt']);
    expect(CONTROL_KEYS).toEqual(['kbd', 'fav']);
  });

  it('every grid id is labelled', () => {
    for (const row of COMMAND_ROWS) for (const id of row) expect(typeof KEY_LABELS[id]).toBe('string');
  });

  it('arrows and ⌫ auto-repeat', () => {
    expect([...REPEAT_KEYS].sort()).toEqual(['del', 'down', 'left', 'right', 'up']);
  });
});

describe('keyAction', () => {
  it('maps named keys, symbols, and Enter/Backspace', () => {
    expect(keyAction('esc')).toEqual({ kind: 'key', name: 'Escape' });
    expect(keyAction('tab')).toEqual({ kind: 'key', name: 'Tab' });
    expect(keyAction('up')).toEqual({ kind: 'key', name: 'Up' });
    expect(keyAction('enter')).toEqual({ kind: 'key', name: 'Enter' });
    expect(keyAction('del')).toEqual({ kind: 'key', name: 'BSpace' });
    expect(keyAction('pipe')).toEqual({ kind: 'text', ch: '|' });
    expect(keyAction('bslash')).toEqual({ kind: 'text', ch: '\\' });
  });
  it('returns null for control ids, modifier ids, and unknowns', () => {
    expect(keyAction('kbd')).toBe(null);
    expect(keyAction('fav')).toBe(null);
    expect(keyAction('ctrl')).toBe(null);
    expect(keyAction('nope')).toBe(null);
  });
});

describe('live modifiers (ctrl/shift/alt)', () => {
  it('a tap cycles off -> armed -> locked -> off', () => {
    expect(tapMod(MOD_OFF)).toBe(MOD_ARMED);
    expect(tapMod(MOD_ARMED)).toBe(MOD_LOCKED);
    expect(tapMod(MOD_LOCKED)).toBe(MOD_OFF);
  });
  it('modActive true when armed or locked', () => {
    expect(modActive(MOD_OFF)).toBe(false);
    expect(modActive(MOD_ARMED)).toBe(true);
    expect(modActive(MOD_LOCKED)).toBe(true);
  });
  it('consuming collapses armed modifiers to off but keeps locked ones', () => {
    expect(consumeMods({ ctrl: MOD_ARMED, shift: MOD_LOCKED, alt: MOD_OFF }))
      .toEqual({ ctrl: MOD_OFF, shift: MOD_LOCKED, alt: MOD_OFF });
  });
  it('withMods composes Ctrl -> C-<x>, Alt -> M-<x> for letters/digits', () => {
    expect(withMods({ kind: 'text', ch: 'r' }, { ctrl: MOD_ARMED })).toEqual({ kind: 'key', name: 'C-r' });
    expect(withMods({ kind: 'text', ch: '1' }, { alt: MOD_LOCKED })).toEqual({ kind: 'key', name: 'M-1' });
  });
  it('withMods: Shift+Tab -> BTab, Shift+arrow -> S-<Arrow>', () => {
    expect(withMods({ kind: 'key', name: 'Tab' }, { shift: MOD_ARMED })).toEqual({ kind: 'key', name: 'BTab' });
    expect(withMods({ kind: 'key', name: 'Up' }, { shift: MOD_ARMED })).toEqual({ kind: 'key', name: 'S-Up' });
  });
  it('withMods leaves symbols/other untouched and no active modifier is a passthrough', () => {
    expect(withMods({ kind: 'text', ch: '|' }, { ctrl: MOD_ARMED })).toEqual({ kind: 'text', ch: '|' });
    expect(withMods({ kind: 'text', ch: 'r' }, { ctrl: MOD_OFF })).toEqual({ kind: 'text', ch: 'r' });
  });
});
