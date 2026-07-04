import { describe, it, expect } from 'vitest';
import {
  FIXED_KEYS, SCROLL_KEYS, MODIFIERS, KEY_LABELS, REPEAT_KEYS, keyAction,
  MOD_OFF, MOD_ARMED, MOD_LOCKED, tapMod, modActive, consumeMods, withMods,
} from '../src/keybarKeys.js';

describe('keybarKeys layout', () => {
  it('the fixed row holds the most-used keys (Esc/Tab + Ctrl/Shift modifiers + ⌫)', () => {
    expect(FIXED_KEYS).toEqual(['esc', 'tab', 'ctrl', 'shift', 'del']);
  });

  it('ctrl/shift/alt are the live modifiers', () => {
    expect(MODIFIERS).toEqual(['ctrl', 'shift', 'alt']);
  });

  it('the scroll row leads with the arrow cluster in both modes', () => {
    expect(SCROLL_KEYS.command.slice(0, 4)).toEqual(['left', 'up', 'down', 'right']);
    expect(SCROLL_KEYS.agent.slice(0, 4)).toEqual(['left', 'up', 'down', 'right']);
  });

  it('command scroll row carries the buried shell symbols; agent carries menu/slash keys', () => {
    expect(SCROLL_KEYS.command).toEqual(expect.arrayContaining(['pipe', 'bslash', 'tilde', 'gt', 'under']));
    expect(SCROLL_KEYS.agent).toEqual(expect.arrayContaining(['slash', 'at', 'n1', 'n2', 'n3']));
  });

  it('both scroll rows end with Alt, and every key is labelled', () => {
    for (const row of [SCROLL_KEYS.command, SCROLL_KEYS.agent]) {
      expect(row).toContain('alt');
      for (const id of row) expect(typeof KEY_LABELS[id]).toBe('string');
    }
    for (const id of FIXED_KEYS) expect(typeof KEY_LABELS[id]).toBe('string');
  });

  it('arrows and ⌫ auto-repeat', () => {
    expect([...REPEAT_KEYS].sort()).toEqual(['del', 'down', 'left', 'right', 'up']);
  });
});

describe('keyAction', () => {
  it('maps named keys and shell symbols', () => {
    expect(keyAction('esc')).toEqual({ kind: 'key', name: 'Escape' });
    expect(keyAction('tab')).toEqual({ kind: 'key', name: 'Tab' });
    expect(keyAction('up')).toEqual({ kind: 'key', name: 'Up' });
    expect(keyAction('del')).toEqual({ kind: 'key', name: 'BSpace' });
    expect(keyAction('pipe')).toEqual({ kind: 'text', ch: '|' });
    expect(keyAction('bslash')).toEqual({ kind: 'text', ch: '\\' });
    expect(keyAction('n1')).toEqual({ kind: 'text', ch: '1' });
    expect(keyAction('slash')).toEqual({ kind: 'text', ch: '/' });
  });
  it('returns null for a modifier id or unknown id (modifiers are not dispatched as keys)', () => {
    expect(keyAction('ctrl')).toBe(null);
    expect(keyAction('shift')).toBe(null);
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
