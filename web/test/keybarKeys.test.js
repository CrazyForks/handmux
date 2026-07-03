import { describe, it, expect } from 'vitest';
import {
  CORE_COLS, CONTEXT_PAGES, KEY_LABELS, REPEAT_KEYS, keyAction,
  CTRL_OFF, CTRL_ARMED, CTRL_LOCKED, tapCtrl, ctrlActive, consumeCtrl, withCtrl,
} from '../src/keybarKeys.js';

describe('keybarKeys layout', () => {
  it('the fixed core is the inverted-T arrow cluster (Esc/Tab on the top corners)', () => {
    expect(CORE_COLS).toEqual([
      ['esc', 'left'],
      ['up', 'down'],
      ['tab', 'right'],
    ]);
  });

  it('every context is a list of pages of two-key columns, each key labelled', () => {
    for (const pages of Object.values(CONTEXT_PAGES)) {
      expect(Array.isArray(pages)).toBe(true);
      for (const page of pages) {
        for (const col of page) {
          expect(col).toHaveLength(2);
          for (const id of col) expect(typeof KEY_LABELS[id]).toBe('string');
        }
      }
    }
  });

  it('shell context surfaces the buried shell symbols; agent context the menu/slash keys', () => {
    const flat = (ctx) => CONTEXT_PAGES[ctx].flat(2);
    expect(flat('shell')).toEqual(expect.arrayContaining(['pipe', 'bslash', 'tilde', 'gt', 'under']));
    expect(flat('agent')).toEqual(expect.arrayContaining(['n1', 'n2', 'n3', 'stab', 'compact']));
  });

  it('only arrows auto-repeat', () => {
    expect([...REPEAT_KEYS].sort()).toEqual(['down', 'left', 'right', 'up']);
  });
});

describe('keyAction', () => {
  it('maps named keys (arrows, Esc/Tab, Shift+Tab->BTab, Ctrl combos, Home/End)', () => {
    expect(keyAction('esc')).toEqual({ kind: 'key', name: 'Escape' });
    expect(keyAction('up')).toEqual({ kind: 'key', name: 'Up' });
    expect(keyAction('right')).toEqual({ kind: 'key', name: 'Right' });
    expect(keyAction('tab')).toEqual({ kind: 'key', name: 'Tab' });
    expect(keyAction('stab')).toEqual({ kind: 'key', name: 'BTab' });
    expect(keyAction('ctrlc')).toEqual({ kind: 'key', name: 'C-c' });
    expect(keyAction('ctrlr')).toEqual({ kind: 'key', name: 'C-r' });
    expect(keyAction('home')).toEqual({ kind: 'key', name: 'Home' });
    expect(keyAction('end')).toEqual({ kind: 'key', name: 'End' });
  });

  it('maps literal-character keys: shell symbols and slash-command shortcuts', () => {
    expect(keyAction('pipe')).toEqual({ kind: 'text', ch: '|' });
    expect(keyAction('bslash')).toEqual({ kind: 'text', ch: '\\' });
    expect(keyAction('tilde')).toEqual({ kind: 'text', ch: '~' });
    expect(keyAction('gt')).toEqual({ kind: 'text', ch: '>' });
    expect(keyAction('n1')).toEqual({ kind: 'text', ch: '1' });
    expect(keyAction('compact')).toEqual({ kind: 'text', ch: '/compact' });
    expect(keyAction('btw')).toEqual({ kind: 'text', ch: '/btw ' }); // trailing space, ready for the note
    expect(keyAction('loop')).toEqual({ kind: 'text', ch: '/loop ' });
  });

  it('returns null for an unknown id', () => {
    expect(keyAction('nope')).toBe(null);
  });
});

describe('Ctrl live modifier', () => {
  it('a tap cycles off -> armed -> locked -> off', () => {
    expect(tapCtrl(CTRL_OFF)).toBe(CTRL_ARMED);
    expect(tapCtrl(CTRL_ARMED)).toBe(CTRL_LOCKED);
    expect(tapCtrl(CTRL_LOCKED)).toBe(CTRL_OFF);
  });

  it('ctrlActive is true when armed or locked', () => {
    expect(ctrlActive(CTRL_OFF)).toBe(false);
    expect(ctrlActive(CTRL_ARMED)).toBe(true);
    expect(ctrlActive(CTRL_LOCKED)).toBe(true);
  });

  it('consuming collapses an armed (one-shot) modifier but keeps a locked one', () => {
    expect(consumeCtrl(CTRL_ARMED)).toBe(CTRL_OFF);
    expect(consumeCtrl(CTRL_LOCKED)).toBe(CTRL_LOCKED);
    expect(consumeCtrl(CTRL_OFF)).toBe(CTRL_OFF);
  });

  it('withCtrl turns a letter/digit into C-<x>, leaves named keys and symbols alone', () => {
    expect(withCtrl({ kind: 'text', ch: 'r' })).toEqual({ kind: 'key', name: 'C-r' });
    expect(withCtrl({ kind: 'text', ch: '1' })).toEqual({ kind: 'key', name: 'C-1' });
    expect(withCtrl({ kind: 'text', ch: 'W' })).toEqual({ kind: 'key', name: 'C-w' }); // lowercased
    expect(withCtrl({ kind: 'text', ch: '|' })).toEqual({ kind: 'text', ch: '|' }); // symbol untouched
    expect(withCtrl({ kind: 'key', name: 'Up' })).toEqual({ kind: 'key', name: 'Up' }); // named untouched
  });
});
