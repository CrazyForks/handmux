import { describe, it, expect, beforeEach } from 'vitest';
import { readSessionHash, writeSessionHash, readRoute, buildDeepLink, buildInboxLink } from '../src/hashRoute.js';

beforeEach(() => {
  history.replaceState(null, '', location.pathname); // clear hash
});

const setHash = (h) => { window.location.hash = h; };

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

  it('preserves the current entry state (must not clobber a back-button guard)', () => {
    // openSession writes the hash on top of whatever entry is current — often the useExitConfirm
    // guard ({exitGuard}) or a useBackButton overlay ({overlay}). Nulling that state desyncs the
    // back-button state machines from real history (spurious "press again to exit", silent exits,
    // several backs needed). writeSessionHash only changes the URL, so it must keep the state.
    history.replaceState({ exitGuard: true }, '', location.pathname);
    writeSessionHash('main');
    expect(history.state).toEqual({ exitGuard: true });
    expect(readSessionHash()).toBe('main');
  });
});

describe('hashRoute deep link', () => {
  beforeEach(() => { history.replaceState(null, '', '#'); });

  it('parses a three-level deep link, decoding each segment', () => {
    history.replaceState(null, '', buildDeepLink({ session: 'my proj', window: '@5', pane: '%4' }));
    expect(readRoute()).toEqual({ session: 'my proj', window: '@5', pane: '%4', inbox: false, inboxId: null });
  });

  it('buildDeepLink encodes pane ids (the % must survive)', () => {
    const h = buildDeepLink({ session: 'p', window: '@1', pane: '%12' });
    expect(h).toBe('#/s/p/w/%401/p/%2512');
  });

  it('falls back to the legacy #<name> form (window/pane null)', () => {
    history.replaceState(null, '', '#legacy-name');
    expect(readRoute()).toEqual({ session: 'legacy-name', window: null, pane: null, inbox: false, inboxId: null });
  });

  it('empty hash → all null', () => {
    history.replaceState(null, '', '#');
    expect(readRoute()).toEqual({ session: null, window: null, pane: null, inbox: false, inboxId: null });
  });
});

describe('readRoute inbox', () => {
  beforeEach(() => setHash(''));
  it('parses #/inbox (list)', () => {
    setHash('#/inbox');
    const r = readRoute();
    expect(r.inbox).toBe(true);
    expect(r.inboxId).toBe(null);
    expect(r.session).toBe(null);
  });
  it('parses #/inbox/<id> (detail)', () => {
    setHash('#/inbox/abc123');
    const r = readRoute();
    expect(r.inbox).toBe(true);
    expect(r.inboxId).toBe('abc123');
  });
  it('does not treat a normal session hash as inbox', () => {
    setHash('#mysession');
    const r = readRoute();
    expect(r.inbox).toBe(false);
    expect(r.session).toBe('mysession');
  });
  it('buildInboxLink encodes the id', () => {
    expect(buildInboxLink('a/b')).toBe('#/inbox/a%2Fb');
    expect(buildInboxLink()).toBe('#/inbox');
  });
});
