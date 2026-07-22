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
    await expect(policy().check(url)).resolves.toMatchObject({ allowed: true });
  });

  it('returns one approved DNS address so the outbound request can pin resolution', async () => {
    await expect(policy().check('https://portal.corp.example/app')).resolves.toEqual({
      allowed: true,
      address: '10.20.30.40',
      family: 4,
    });
  });

  it('lets an explicitly opened loopback site navigate to another loopback port', async () => {
    const targetPolicy = policy({
      topLevelUrl: 'http://127.0.0.1:5173/',
      lookup: async (hostname) => [{ address: hostname === 'localhost' ? '127.0.0.1' : hostname, family: 4 }],
    });

    await expect(targetPolicy.check('http://127.0.0.1:5173/src/main.js')).resolves.toMatchObject({ allowed: true });
    await expect(targetPolicy.check('http://127.0.0.1:9222/json')).resolves.toMatchObject({ allowed: true });
  });

  it('keeps loopback navigation inside the explicitly opened loopback context', async () => {
    const targetPolicy = policy({
      topLevelUrl: 'http://127.0.0.1:5173/',
      lookup: async (hostname) => [{ address: hostname, family: 4 }],
    });

    targetPolicy.authorizeTopLevel('http://127.0.0.1:3000/');

    await expect(targetPolicy.check('http://127.0.0.1:3000/app.js')).resolves.toMatchObject({ allowed: true });
    await expect(targetPolicy.check('http://127.0.0.1:5173/app.js')).resolves.toMatchObject({ allowed: true });
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

  it('does not let an ordinary top-level hostname rebind to loopback later', async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce([{ address: '203.0.113.10', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const targetPolicy = policy({ topLevelUrl: 'https://evil.example/', lookup });

    await expect(targetPolicy.check('https://evil.example/')).resolves.toMatchObject({ allowed: true });
    await expect(targetPolicy.check('https://evil.example/admin')).resolves.toMatchObject({
      allowed: false,
      reason: 'loopback-not-authorized',
    });
  });

  it('fails closed when DNS cannot resolve a destination', async () => {
    const targetPolicy = policy({ lookup: async () => { throw new Error('ENOTFOUND'); } });
    await expect(targetPolicy.check('https://missing.example/')).resolves.toEqual({ allowed: false, reason: 'dns-failed' });
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)'])('blocks non-web URL %s', async (url) => {
    await expect(policy().check(url)).resolves.toEqual({ allowed: false, reason: 'unsupported-protocol' });
  });
});
