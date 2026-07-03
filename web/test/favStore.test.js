import { describe, it, expect, beforeEach } from 'vitest';
import { loadFavs, saveFavs, addFav, removeFav, DEFAULT_FAVS } from '../src/favStore.js';

beforeEach(() => localStorage.clear());

describe('favStore', () => {
  it('seeds agent mode with reply chips + Claude commands, command mode with none by default', () => {
    expect(DEFAULT_FAVS.agent.some((f) => f.kind === 'reply' && f.text === 'ok')).toBe(true);
    expect(DEFAULT_FAVS.agent.some((f) => f.kind === 'cmd' && f.text === '/compact')).toBe(true);
    expect(DEFAULT_FAVS.command).toEqual([]);
  });
  it('loadFavs returns the defaults on first run, then persists edits', () => {
    expect(loadFavs('agent')).toEqual(DEFAULT_FAVS.agent);
    const next = addFav('command', { kind: 'cmd', text: 'npm test' });
    expect(next.at(-1)).toEqual({ kind: 'cmd', text: 'npm test' });
    expect(loadFavs('command')).toEqual(next); // persisted
  });
  it('addFav dedupes by text; removeFav removes by text', () => {
    addFav('command', { kind: 'cmd', text: 'ls' });
    const dup = addFav('command', { kind: 'cmd', text: 'ls' });
    expect(dup.filter((f) => f.text === 'ls')).toHaveLength(1);
    const after = removeFav('command', 'ls');
    expect(after.find((f) => f.text === 'ls')).toBeUndefined();
  });
  it('the two modes are independent', () => {
    addFav('command', { kind: 'cmd', text: 'git status' });
    expect(loadFavs('agent').find((f) => f.text === 'git status')).toBeUndefined();
  });
});
