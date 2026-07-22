import { beforeEach, describe, expect, it } from 'vitest';
import {
  addBrowserHistory,
  clearBrowserHistory,
  normalizeBrowserInput,
  readBrowserHistory,
  readBrowserPrefs,
  setBrowserCloseAfter,
  setBrowserDefaultMode,
  upsertBrowserHistory,
} from '../src/browserState.js';

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
  it('defaults to 10 and accepts only the five product choices', () => {
    expect(readBrowserPrefs()).toEqual({ closeAfter: 10, defaultMode: 'direct' });
    for (const value of [10, 30, 60, 120, null]) {
      setBrowserCloseAfter(value);
      expect(readBrowserPrefs()).toEqual({ closeAfter: value, defaultMode: 'direct' });
    }
    setBrowserCloseAfter(240);
    expect(readBrowserPrefs()).toEqual({ closeAfter: 10, defaultMode: 'direct' });
  });

  it('persists only valid default modes without changing the close timer', () => {
    setBrowserCloseAfter(30);
    setBrowserDefaultMode('proxy');
    expect(readBrowserPrefs()).toEqual({ closeAfter: 30, defaultMode: 'proxy' });

    setBrowserDefaultMode('invalid');
    expect(readBrowserPrefs()).toEqual({ closeAfter: 30, defaultMode: 'direct' });
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

  it('fails closed for malformed persisted history', () => {
    localStorage.setItem('hm_browser_history1', '{bad');
    expect(readBrowserHistory()).toEqual([]);
  });
});
