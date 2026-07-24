import { beforeEach, describe, expect, it } from 'vitest';
import {
  addBrowserHistory,
  BROWSER_CLOSE_AFTER_OPTIONS,
  clearBrowserHistory,
  deleteBrowserHistoryEntry,
  normalizeBrowserInput,
  readBrowserHistory,
  readBrowserPrefs,
  setBrowserCloseAfter,
  setPersistProxyLogin,
  setProxyLoginRetentionDays,
  upsertBrowserHistory,
} from '../src/browserState.js';
import * as browserState from '../src/browserState.js';

beforeEach(() => localStorage.clear());

describe('browser address normalization', () => {
  it.each([
    ['5173', 'http://127.0.0.1:5173/'],
    ['https://portal.example/keys', 'https://portal.example/keys'],
    ['portal.example/keys', 'https://portal.example/keys'],
    ['  http://10.0.0.8:8080/app  ', 'http://10.0.0.8:8080/app'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeBrowserInput(input)).toBe(expected);
  });

  it.each(['', '0', '65536', 'file:///tmp/a', 'javascript:alert(1)', 'not a host'])('rejects %s', (input) => {
    expect(normalizeBrowserInput(input)).toBeNull();
  });
});

describe('browser preferences', () => {
  it('defaults to 10 and accepts only the four finite close choices', () => {
    expect(BROWSER_CLOSE_AFTER_OPTIONS).toEqual([10, 30, 60, 120]);
    expect(readBrowserPrefs()).toEqual({
      closeAfter: 10,
      persistProxyLogin: false, proxyLoginRetentionDays: 30,
    });
    for (const value of [10, 30, 60, 120]) {
      setBrowserCloseAfter(value);
      expect(readBrowserPrefs()).toMatchObject({ closeAfter: value });
    }
    setBrowserCloseAfter(null);
    expect(readBrowserPrefs()).toMatchObject({ closeAfter: 10 });
    setBrowserCloseAfter(240);
    expect(readBrowserPrefs()).toMatchObject({ closeAfter: 10 });
  });

  it('stores proxy login preferences only in device local storage', () => {
    setPersistProxyLogin(true);
    setProxyLoginRetentionDays(null);
    expect(readBrowserPrefs()).toMatchObject({
      persistProxyLogin: true, proxyLoginRetentionDays: null,
    });
    localStorage.setItem('hm_browser_profile_retention1', '14');
    expect(readBrowserPrefs().proxyLoginRetentionDays).toBe(30);
  });
});

describe('browser toolbar entry status', () => {
  it('uses proxy precedence, direct for direct-only tabs, and no status without tabs', () => {
    expect(typeof browserState.browserEntryStatus).toBe('function');
    expect(browserState.browserEntryStatus([])).toBeNull();
    expect(browserState.browserEntryStatus([{ mode: 'direct' }])).toBe('direct');
    expect(browserState.browserEntryStatus([{ mode: 'direct' }, { mode: 'proxy' }])).toBe('proxy');
    expect(browserState.browserEntryStatus([{ mode: 'proxy' }, { mode: 'direct' }])).toBe('proxy');
  });
});

describe('device-local browser history', () => {
  it('stores only title, sanitized URL and visit time without credentials or form state', () => {
    addBrowserHistory({
      url: 'https://user:secret@portal.example/keys',
      title: 'Keys',
      visitedAt: 123,
      password: 'secret',
      form: { query: 'private' },
      session: { cookie: 'private' },
    });

    expect(readBrowserHistory()).toEqual([{
      url: 'https://portal.example/keys',
      title: 'Keys',
      visitedAt: 123,
    }]);
  });

  it('removes common authentication secrets from device-local history URLs', () => {
    addBrowserHistory({
      url: 'https://portal.example/callback?code=secret&token=secret&tab=keys#access_token=secret',
      title: 'Portal',
      visitedAt: 123,
    });
    expect(readBrowserHistory()[0].url).toBe('https://portal.example/callback?tab=keys');
  });

  it('stores the latest valid mode while remaining compatible with old history', () => {
    addBrowserHistory({
      url: 'https://portal.example/', title: 'Portal', visitedAt: 123, lastMode: 'proxy',
    });
    expect(readBrowserHistory()[0].lastMode).toBe('proxy');

    addBrowserHistory({
      url: 'https://old.example/', title: 'Old', visitedAt: 122, lastMode: 'invalid',
    });
    expect(readBrowserHistory().find((entry) => entry.url === 'https://old.example/')).not.toHaveProperty('lastMode');

    upsertBrowserHistory({
      url: 'https://user:secret@portal.example/?token=secret',
      title: 'Updated',
      visitedAt: 124,
      lastMode: 'direct',
    });
    expect(readBrowserHistory()[0]).toEqual({
      url: 'https://portal.example/', title: 'Updated', visitedAt: 124, lastMode: 'direct',
    });
  });

  it('replaces an earlier URL from the same tab session', () => {
    upsertBrowserHistory({
      url: 'https://portal.example/a', title: 'A', visitedAt: 123, sessionId: 'tab-a',
    });
    upsertBrowserHistory({
      url: 'https://portal.example/b', title: 'B', visitedAt: 124, sessionId: 'tab-a',
    });

    expect(readBrowserHistory()).toEqual([{
      url: 'https://portal.example/b',
      title: 'B',
      visitedAt: 124,
      sessionId: 'tab-a',
    }]);
  });

  it('keeps the newest 200 records and can clear them', () => {
    for (let i = 0; i < 205; i += 1) {
      addBrowserHistory({ url: `https://example.com/${i}`, title: `Page ${i}`, visitedAt: i });
    }
    const history = readBrowserHistory();
    expect(history).toHaveLength(200);
    expect(history[0].url).toBe('https://example.com/204');
    expect(history.at(-1).url).toBe('https://example.com/5');

    clearBrowserHistory();
    expect(readBrowserHistory()).toEqual([]);
  });

  it('deletes exactly one history identity without collapsing the same Origin', () => {
    addBrowserHistory({ url: 'https://portal.example/a', title: 'A', visitedAt: 123 });
    addBrowserHistory({ url: 'https://portal.example/b', title: 'B', visitedAt: 124 });
    const [newer, older] = readBrowserHistory();

    deleteBrowserHistoryEntry(older);

    expect(readBrowserHistory()).toEqual([newer]);
  });

  it('fails closed for malformed persisted history', () => {
    localStorage.setItem('hm_browser_history1', '{bad');
    expect(readBrowserHistory()).toEqual([]);
  });
});
