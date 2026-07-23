import { describe, expect, it } from 'vitest';
import { createBrowserBootstrapStore } from '../src/browser/bootstrap.js';

describe('browser preview-origin bootstrap', () => {
  it('issues an origin-bound ticket that can be consumed exactly once', () => {
    const store = createBrowserBootstrapStore({ randomToken: () => 'ticket-a', now: () => 1000 });
    const url = store.issue({
      url: 'https://handmux.example.com:30443/_browser-tab-a/https://target.example/',
      origin: 'https://handmux.example.com:30443',
      deviceId: 'device_abcdefghijklmnopqrstuvwxyz123456',
    });

    expect(url).toBe('https://handmux.example.com:30443/_browser-bootstrap/ticket-a');
    expect(store.consume('/_browser-bootstrap/ticket-a', 'https://other.example')).toBeNull();
    expect(store.consume('/_browser-bootstrap/ticket-a', 'https://handmux.example.com:30443')).toEqual({
      url: 'https://handmux.example.com:30443/_browser-tab-a/https://target.example/',
      deviceId: 'device_abcdefghijklmnopqrstuvwxyz123456',
    });
    expect(store.consume('/_browser-bootstrap/ticket-a', 'https://handmux.example.com:30443')).toBeNull();
  });

  it('rejects expired tickets', () => {
    let now = 1000;
    const store = createBrowserBootstrapStore({ randomToken: () => 'ticket-a', now: () => now, ttlMs: 5000 });
    store.issue({ url: 'https://preview.example/_browser-a/', origin: 'https://preview.example', deviceId: 'device-a' });
    now = 6001;
    expect(store.consume('/_browser-bootstrap/ticket-a', 'https://preview.example')).toBeNull();
  });

  it('rejects malformed ticket paths', () => {
    const store = createBrowserBootstrapStore();
    expect(store.consume('/_browser-bootstrap/%', 'https://preview.example')).toBeNull();
  });

  it('carries one-shot method-preserving redirect metadata', () => {
    const store = createBrowserBootstrapStore({ randomToken: () => 'post-ticket' });
    store.issue({
      url: 'https://b.preview.example/_browser-b/https://target.example/',
      origin: 'https://b.preview.example',
      deviceId: 'device_abcdefghijklmnopqrstuvwxyz123456',
      preserveMethod: true,
      redirectStatus: 307,
    });

    expect(store.consume('/_browser-bootstrap/post-ticket', 'https://b.preview.example'))
      .toMatchObject({ preserveMethod: true, redirectStatus: 307 });
  });
});
