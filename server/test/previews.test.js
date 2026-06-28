// server/test/previews.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreviews, safePreviewName } from '../src/previews.js';

let home, outside, store, clock, previews;
beforeEach(async () => {
  home = await fsp.mkdtemp(join(tmpdir(), 'pvhome-'));
  outside = await fsp.mkdtemp(join(tmpdir(), 'pvout-'));
  await fsp.mkdir(join(home, 'site'));
  store = join(home, 'previews.json');
  clock = { t: 1_000_000 };
  previews = createPreviews({ home, store, now: () => clock.t, ttlMs: 600_000 });
});
afterEach(async () => {
  await fsp.rm(home, { recursive: true, force: true });
  await fsp.rm(outside, { recursive: true, force: true });
});

describe('safePreviewName', () => {
  it('accepts a slug, rejects dots/slashes/empty', () => {
    expect(safePreviewName('my-sess_1.2')).toBe('my-sess_1.2');
    expect(safePreviewName('.')).toBeNull();
    expect(safePreviewName('..')).toBeNull();
    expect(safePreviewName('.hidden')).toBeNull();
    expect(safePreviewName('a/b')).toBeNull();
    expect(safePreviewName('')).toBeNull();
    expect(safePreviewName('空格 x')).toBeNull();
  });
  it('lowercases (subdomain hosts are case-insensitive)', () => {
    expect(safePreviewName('jly-Tunlite-0')).toBe('jly-tunlite-0');
  });
});

describe('register', () => {
  it('registers a dir under home and returns expiresAt = now + ttl', async () => {
    const out = await previews.register({ name: 'foo', dir: join(home, 'site') });
    expect(out.name).toBe('foo');
    expect(out.kind).toBe('static');
    expect(out.expiresAt).toBe(1_000_000 + 600_000);
  });
  it('rejects a dir outside home', async () => {
    expect(await previews.register({ name: 'foo', dir: outside })).toMatchObject({ status: 400 });
  });
  it('rejects a missing dir', async () => {
    expect(await previews.register({ name: 'foo', dir: join(home, 'nope') })).toMatchObject({ status: 404 });
  });
  it('rejects a bad name', async () => {
    expect(await previews.register({ name: '../x', dir: join(home, 'site') })).toMatchObject({ status: 400 });
  });
  it('same name updates dir and resets expiry (renew = reset, not extend)', async () => {
    await previews.register({ name: 'foo', dir: join(home, 'site') });
    clock.t = 1_500_000;
    const out = await previews.register({ name: 'foo', dir: join(home, 'site') });
    expect(out.expiresAt).toBe(1_500_000 + 600_000);
    expect(previews.list()).toHaveLength(1);
  });
});

describe('get / list / remove', () => {
  it('get returns active before expiry, expired after', async () => {
    await previews.register({ name: 'foo', dir: join(home, 'site') });
    expect(previews.get('foo').state).toBe('active');
    clock.t += 600_001;
    expect(previews.get('foo').state).toBe('expired');
    expect(previews.get('foo').state).toBe('missing'); // expired entry was purged
  });
  it('get returns missing for unknown name', () => {
    expect(previews.get('nope').state).toBe('missing');
  });
  it('list returns only active and purges expired', async () => {
    await previews.register({ name: 'a', dir: join(home, 'site') });
    clock.t += 600_001;
    await previews.register({ name: 'b', dir: join(home, 'site') });
    const list = previews.list();
    expect(list.map((e) => e.name)).toEqual(['b']);
  });
  it('remove drops an entry', async () => {
    await previews.register({ name: 'foo', dir: join(home, 'site') });
    previews.remove('foo');
    expect(previews.get('foo').state).toBe('missing');
  });
});

describe('dynamic register', () => {
  it('rejects a port when dynamic is disabled', async () => {
    // default `previews` in beforeEach has no dynamicEnabled flag → disabled
    expect(await previews.register({ name: 'app', port: 3000 })).toMatchObject({ error: 'dynamic disabled', status: 400 });
  });

  describe('with dynamic enabled', () => {
    let dyn;
    beforeEach(() => {
      dyn = createPreviews({
        home, store, now: () => clock.t, ttlMs: 600_000,
        dynamicEnabled: true,
        probePort: async (p) => (p === 3000 ? '127.0.0.1' : null), // only 3000 is "listening"
      });
    });
    it('registers a listening port as a dynamic entry', async () => {
      const out = await dyn.register({ name: 'app', port: 3000 });
      expect(out).toMatchObject({ name: 'app', kind: 'dynamic', expiresAt: 1_000_000 + 600_000 });
      expect(dyn.get('app')).toMatchObject({ state: 'active', entry: { kind: 'dynamic', port: 3000 } });
    });
    it('list exposes kind + port for a dynamic entry (no dir)', async () => {
      await dyn.register({ name: 'app', port: 3000 });
      expect(dyn.list()).toEqual([{ name: 'app', kind: 'dynamic', port: 3000, expiresAt: 1_000_000 + 600_000 }]);
    });
    it('rejects a non-numeric / out-of-range port', async () => {
      expect(await dyn.register({ name: 'app', port: 0 })).toMatchObject({ status: 400 });
      expect(await dyn.register({ name: 'app', port: 70000 })).toMatchObject({ status: 400 });
      expect(await dyn.register({ name: 'app', port: 'abc' })).toMatchObject({ status: 400 });
    });
    it('rejects a port that is not listening', async () => {
      expect(await dyn.register({ name: 'app', port: 4321 })).toMatchObject({ error: 'port not listening', status: 400 });
    });
    it('stores the loopback host the probe found (so the proxy connects to the right IPv4/IPv6)', async () => {
      const dyn6 = createPreviews({
        home, store, now: () => clock.t, ttlMs: 600_000, dynamicEnabled: true,
        probePort: async () => '::1', // app bound IPv6-only localhost
      });
      await dyn6.register({ name: 'app', port: 5173 });
      expect(dyn6.get('app').entry).toMatchObject({ kind: 'dynamic', port: 5173, host: '::1' });
    });
    // The real (uninjected) probe must find a server bound ONLY to IPv6 localhost (::1) — the macOS
    // `localhost` default that previously read as "port not listening".
    it('the real probe finds an IPv6-only (::1) localhost server', async () => {
      const srv = net.createServer((s) => s.destroy());
      await new Promise((r, j) => { srv.once('error', j); srv.listen(0, '::1', r); });
      const port = srv.address().port;
      try {
        const real = createPreviews({ home, store, now: () => clock.t, ttlMs: 600_000, dynamicEnabled: true });
        const out = await real.register({ name: 'app6', port });
        expect(out).toMatchObject({ name: 'app6', kind: 'dynamic' });
        expect(real.get('app6').entry.host).toBe('::1');
      } finally {
        await new Promise((r) => srv.close(r));
      }
    });
    it('can switch a name from static to dynamic (upsert + reset expiry)', async () => {
      await dyn.register({ name: 'x', dir: join(home, 'site') });
      clock.t = 1_200_000;
      const out = await dyn.register({ name: 'x', port: 3000 });
      expect(out.kind).toBe('dynamic');
      expect(out.expiresAt).toBe(1_200_000 + 600_000);
      expect(dyn.list()).toHaveLength(1);
    });
    it('list defaults a legacy entry (no kind) to static', async () => {
      await dyn.register({ name: 'x', dir: join(home, 'site') });
      // simulate a pre-kind entry written by an older build
      const raw = JSON.parse(await fsp.readFile(store, 'utf8'));
      delete raw[0].kind;
      await fsp.writeFile(store, JSON.stringify(raw));
      expect(dyn.list()[0].kind).toBe('static');
    });
  });
});
