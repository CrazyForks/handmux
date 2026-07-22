import { describe, expect, it, vi } from 'vitest';
import { createBrowserTargetPolicy } from '../src/browser/targetPolicy.js';

function policy(options = {}) {
  return createBrowserTargetPolicy({
    topLevelUrl: 'https://portal.corp.example/',
    handmuxOrigin: 'https://handmux.example:30443',
    lookup: async () => [{ address: '10.20.30.40', family: 4 }],
    ...options,
  });
}

describe('browser target policy', () => {
  it.each([
    'https://public.example/path',
    'https://service.corp.example/',
    'http://10.0.0.8:8080/',
    'http://192.168.1.20/',
    'http://[fd00::12]/',
  ])('allows computer-reachable HTTP(S) target %s', async (url) => {
    await expect(policy().check(url)).resolves.toEqual({ allowed: true });
  });

  it('allows loopback only for the explicitly opened top-level origin', async () => {
    const targetPolicy = policy({
      topLevelUrl: 'http://127.0.0.1:5173/',
      lookup: async (hostname) => [{ address: hostname === 'localhost' ? '127.0.0.1' : hostname, family: 4 }],
    });

    await expect(targetPolicy.check('http://127.0.0.1:5173/src/main.js')).resolves.toEqual({ allowed: true });
    await expect(targetPolicy.check('http://127.0.0.1:9222/json')).resolves.toMatchObject({ allowed: false, reason: 'loopback-not-authorized' });
  });

  it('moves explicit loopback authorization when the user navigates the address bar', async () => {
    const targetPolicy = policy({
      topLevelUrl: 'http://127.0.0.1:5173/',
      lookup: async (hostname) => [{ address: hostname, family: 4 }],
    });

    targetPolicy.authorizeTopLevel('http://127.0.0.1:3000/');

    await expect(targetPolicy.check('http://127.0.0.1:3000/app.js')).resolves.toEqual({ allowed: true });
    await expect(targetPolicy.check('http://127.0.0.1:5173/app.js')).resolves.toMatchObject({
      allowed: false,
      reason: 'loopback-not-authorized',
    });
  });

  it.each([
    ['http://0.0.0.0/', 'unspecified'],
    ['http://169.254.169.254/latest/meta-data/', 'link-local'],
    ['http://224.0.0.1/', 'multicast'],
    ['http://[::]/', 'unspecified'],
    ['http://[fe80::1]/', 'link-local'],
    ['http://[ff02::1]/', 'multicast'],
  ])('blocks sensitive address %s', async (url, reason) => {
    await expect(policy().check(url)).resolves.toMatchObject({ allowed: false, reason });
  });

  it('blocks the Handmux application origin and API', async () => {
    await expect(policy().check('https://handmux.example:30443/api/states')).resolves.toEqual({
      allowed: false,
      reason: 'handmux-origin',
    });
  });

  it('checks every DNS result and blocks rebinding to a sensitive address', async () => {
    const lookup = vi.fn(async () => [
      { address: '10.20.30.40', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    const targetPolicy = policy({ lookup });

    await expect(targetPolicy.check('https://rebind.example/')).resolves.toMatchObject({ allowed: false, reason: 'link-local' });
    expect(lookup).toHaveBeenCalledWith('rebind.example', { all: true, verbatim: true });
  });

  it('fails closed when DNS cannot resolve a destination', async () => {
    const targetPolicy = policy({ lookup: async () => { throw new Error('ENOTFOUND'); } });
    await expect(targetPolicy.check('https://missing.example/')).resolves.toEqual({ allowed: false, reason: 'dns-failed' });
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)'])('blocks non-web URL %s', async (url) => {
    await expect(policy().check(url)).resolves.toEqual({ allowed: false, reason: 'unsupported-protocol' });
  });
});
