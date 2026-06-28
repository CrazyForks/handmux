import { describe, it, expect, beforeEach } from 'vitest';
import { readSessionHash, writeSessionHash, readRoute, buildDeepLink } from '../src/hashRoute.js';

beforeEach(() => {
  history.replaceState(null, '', location.pathname); // clear hash
});

describe('hashRoute', () => {
  it('returns empty string when there is no hash', () => {
    expect(readSessionHash()).toBe('');
  });

  it('reads and decodes the session name from the hash', () => {
    history.replaceState(null, '', '#main');
    expect(readSessionHash()).toBe('main');
    history.replaceState(null, '', `#${encodeURIComponent('my work')}`);
    expect(readSessionHash()).toBe('my work');
  });

  it('writes an encoded hash without adding history entries', () => {
    const before = history.length;
    writeSessionHash('my work');
    expect(location.hash).toBe(`#${encodeURIComponent('my work')}`);
    expect(readSessionHash()).toBe('my work');
    expect(history.length).toBe(before); // replaceState, not pushState
  });
});

describe('hashRoute deep link', () => {
  beforeEach(() => { history.replaceState(null, '', '#'); });

  it('parses a three-level deep link, decoding each segment', () => {
    history.replaceState(null, '', buildDeepLink({ session: 'my proj', window: '@5', pane: '%4' }));
    expect(readRoute()).toEqual({ session: 'my proj', window: '@5', pane: '%4' });
  });

  it('buildDeepLink encodes pane ids (the % must survive)', () => {
    const h = buildDeepLink({ session: 'p', window: '@1', pane: '%12' });
    expect(h).toBe('#/s/p/w/%401/p/%2512');
  });

  it('falls back to the legacy #<name> form (window/pane null)', () => {
    history.replaceState(null, '', '#legacy-name');
    expect(readRoute()).toEqual({ session: 'legacy-name', window: null, pane: null });
  });

  it('empty hash → all null', () => {
    history.replaceState(null, '', '#');
    expect(readRoute()).toEqual({ session: null, window: null, pane: null });
  });
});
