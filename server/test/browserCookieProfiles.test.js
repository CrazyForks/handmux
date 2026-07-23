import { describe, expect, it, vi } from 'vitest';
import hammerhead from 'testcafe-hammerhead';
import { createDeviceCookieProfiles } from '../src/browser/cookieProfiles.js';

const DEVICE_A = 'device-a';
const DEVICE_B = 'device-b';
const createCookies = () => new hammerhead.Session([]).cookies;
const headerFor = (cookies, url) => cookies.getHeader({
  url,
  hostname: new URL(url).hostname,
});

describe('device cookie profiles', () => {
  it('shares real-domain cookies between sessions for one device only', () => {
    const profiles = createDeviceCookieProfiles({ createCookies });
    const a = createCookies();
    const b = createCookies();
    const other = createCookies();
    profiles.attach(DEVICE_A, a);
    profiles.attach(DEVICE_A, b);
    profiles.attach(DEVICE_B, other);

    a.setByServer('https://sso.corp.example/login', [
      'sso_token=one; Domain=sso.corp.example; Path=/; HttpOnly; Secure',
    ]);

    expect(headerFor(b, 'https://sso.corp.example/authorize')).toContain('sso_token=one');
    expect(headerFor(other, 'https://sso.corp.example/authorize')).toBeNull();
  });

  it('keeps host-only cookies isolated by their real hostname', () => {
    const profiles = createDeviceCookieProfiles({ createCookies });
    const a = createCookies();
    const b = createCookies();
    profiles.attach(DEVICE_A, a);
    profiles.attach(DEVICE_A, b);

    a.setByServer('https://app-a.example/login', ['host_session=a; Path=/']);
    b.setByServer('https://app-b.example/login', ['host_session=b; Path=/']);

    expect(headerFor(a, 'https://app-a.example/home')).toContain('host_session=a');
    expect(headerFor(a, 'https://app-a.example/home')).not.toContain('host_session=b');
    expect(headerFor(b, 'https://app-b.example/home')).toContain('host_session=b');
    expect(headerFor(b, 'https://app-b.example/home')).not.toContain('host_session=a');
  });

  it('keeps per-session pending sync queues while sharing the backing jar', () => {
    const profiles = createDeviceCookieProfiles({ createCookies });
    const a = createCookies();
    const b = createCookies();
    profiles.attach(DEVICE_A, a);
    profiles.attach(DEVICE_A, b);
    a.setCookies([{ name: 'client', value: 'a', domain: 'app.example', path: '/' }]);

    expect(a.takePendingSyncCookies()).toHaveLength(1);
    expect(b.takePendingSyncCookies()).toHaveLength(0);
  });

  it('clears only cookies matching the requested real URL', () => {
    const onMutation = vi.fn();
    const profileCookies = createCookies();
    const deleteCookies = vi.spyOn(profileCookies, 'deleteCookies');
    const profiles = createDeviceCookieProfiles({ createCookies: () => profileCookies, onMutation });
    const cookies = createCookies();
    profiles.attach(DEVICE_A, cookies);
    // No Max-Age, Expires, or SameSite produces Hammerhead's lossy Infinity/null/undefined combination.
    cookies.setByServer('https://app-a.example/login', ['session=a; Path=/']);
    cookies.setByServer('https://app-b.example/login', ['session=b; Path=/']);
    onMutation.mockClear();

    expect(profiles.clear(DEVICE_A, { url: 'https://app-a.example/' })).toEqual({ cleared: true });

    expect(headerFor(cookies, 'https://app-a.example/')).toBeNull();
    expect(headerFor(cookies, 'https://app-b.example/')).toContain('session=b');
    expect(deleteCookies).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'session', domain: 'app-a.example', expires: 'Infinity', maxAge: null, sameSite: undefined,
      }),
    ], ['https://app-a.example/']);
    expect(onMutation).toHaveBeenCalledOnce();
    expect(onMutation).toHaveBeenCalledWith(DEVICE_A);
  });

  it('replaces the complete jar without merging session pending queues', () => {
    const profiles = createDeviceCookieProfiles({ createCookies });
    const a = createCookies();
    const b = createCookies();
    profiles.attach(DEVICE_A, a);
    profiles.attach(DEVICE_A, b);
    a.setCookies([{ name: 'client', value: 'a', domain: 'app.example', path: '/' }]);

    expect(profiles.clear(DEVICE_A, {})).toEqual({ cleared: true });

    expect(headerFor(a, 'https://app.example/')).toBeNull();
    expect(headerFor(b, 'https://app.example/')).toBeNull();
    expect(a.takePendingSyncCookies()).toHaveLength(0);
    expect(b.takePendingSyncCookies()).toHaveLength(0);
  });

  it('restores wrapped methods on detach and emits one callback per mutation', () => {
    const onMutation = vi.fn();
    const profiles = createDeviceCookieProfiles({ createCookies, onMutation });
    const cookies = createCookies();
    const original = {
      setByServer: cookies.setByServer,
      setByClient: cookies.setByClient,
      setCookies: cookies.setCookies,
      deleteCookies: cookies.deleteCookies,
    };
    const detach = profiles.attach(DEVICE_A, cookies);

    cookies.setByServer('https://app.example/', ['one=1; Path=/']);
    cookies.setByClient([{ key: 'two', value: '2', domain: 'app.example', path: '/' }]);
    cookies.setCookies([{ name: 'three', value: '3', domain: 'app.example', path: '/' }]);
    cookies.deleteCookies([{ name: 'three', domain: 'app.example', path: '/' }], ['https://app.example/']);

    expect(onMutation).toHaveBeenCalledTimes(4);
    for (const call of onMutation.mock.calls) expect(call).toEqual([DEVICE_A]);
    expect(onMutation).toHaveBeenLastCalledWith(DEVICE_A);

    detach();
    for (const [name, method] of Object.entries(original)) expect(cookies[name]).toBe(method);
    cookies.setByServer('https://app.example/', ['four=4; Path=/']);
    expect(onMutation).toHaveBeenCalledTimes(4);
  });

  it('serializes, removes, and reports profiles by device', () => {
    const profiles = createDeviceCookieProfiles({ createCookies });
    const cookies = createCookies();
    profiles.attach(DEVICE_A, cookies);
    cookies.setByServer('https://app.example/', ['session=a; Path=/']);

    expect(profiles.has(DEVICE_A)).toBe(true);
    expect(profiles.has(DEVICE_B)).toBe(false);
    expect(profiles.serialize(DEVICE_A)).toContain('"key":"session"');
    expect(profiles.serialize(DEVICE_B)).toBeNull();
    expect(profiles.remove(DEVICE_A)).toBe(true);
    expect(profiles.remove(DEVICE_A)).toBe(false);
    expect(profiles.has(DEVICE_A)).toBe(false);
    expect(profiles.clear(DEVICE_B, {})).toEqual({ cleared: false });
  });
});

describe('device cookie profile persistence and retention', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const adapter = (overrides = {}) => ({
    read: vi.fn(async () => null),
    write: vi.fn(),
    remove: vi.fn(),
    close: vi.fn(),
    ...overrides,
  });

  it('never persists by default, then restores fresh profiles but saves used memory', async () => {
    vi.useFakeTimers();
    try {
      const disk = createCookies();
      disk.setByServer('https://app.example/', ['session=stale; Path=/']);
      const persistence = adapter({
        read: vi.fn(async (id) => id === DEVICE_A ? disk.serializeJar() : null),
      });
      const profiles = createDeviceCookieProfiles({ createCookies, persistence });
      const used = createCookies();
      profiles.attach(DEVICE_B, used);
      used.setByServer('https://app.example/', ['session=current; Path=/']);
      await vi.advanceTimersByTimeAsync(500);
      expect(persistence.write).not.toHaveBeenCalled();

      expect(await profiles.configure(DEVICE_A, { persist: true, retentionDays: 7 })).toEqual({
        persist: true, retentionDays: 7, warning: null,
      });
      await profiles.configure(DEVICE_A, { persist: true, retentionDays: 7 });
      await profiles.configure(DEVICE_B, { persist: true, retentionDays: 30 });
      const restored = createCookies();
      profiles.attach(DEVICE_A, restored);

      expect(headerFor(restored, 'https://app.example/')).toContain('session=stale');
      expect(headerFor(used, 'https://app.example/')).toContain('session=current');
      expect(persistence.read.mock.calls.filter(([id]) => id === DEVICE_A)).toHaveLength(1);
      expect(persistence.read.mock.calls.filter(([id]) => id === DEVICE_B)).toHaveLength(0);
      expect(persistence.write.mock.calls[0][1]).toContain('"value":"current"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables persistence by deleting disk without clearing memory', async () => {
    const persistence = adapter();
    const profiles = createDeviceCookieProfiles({ createCookies, persistence });
    await profiles.configure(DEVICE_A, { persist: true, retentionDays: 30 });
    const cookies = createCookies();
    profiles.attach(DEVICE_A, cookies);
    cookies.setByServer('https://app.example/', ['session=current; Path=/']);

    expect(await profiles.configure(DEVICE_A, { persist: false, retentionDays: 7 })).toEqual({
      persist: false, retentionDays: 7, warning: null,
    });
    expect(persistence.remove).toHaveBeenCalledWith(DEVICE_A);
    expect(headerFor(cookies, 'https://app.example/')).toContain('session=current');
  });

  it('recovers unreadable and unrestorable profiles with an empty jar and warning', async () => {
    const persistence = adapter({
      read: vi.fn()
        .mockRejectedValueOnce(new Error('browser profile authentication failed'))
        .mockResolvedValueOnce('{broken'),
    });
    const profiles = createDeviceCookieProfiles({ createCookies, persistence });

    for (const deviceId of [DEVICE_A, DEVICE_B]) {
      await expect(profiles.configure(deviceId, { persist: true, retentionDays: 30 })).resolves.toEqual({
        persist: true, retentionDays: 30, warning: 'profile-recovery-failed',
      });
      const cookies = createCookies();
      profiles.attach(deviceId, cookies);
      expect(headerFor(cookies, 'https://app.example/')).toBeNull();
    }
    expect(persistence.remove).toHaveBeenCalledWith(DEVICE_A);
    expect(persistence.remove).toHaveBeenCalledWith(DEVICE_B);
  });

  it('debounces the existing mutation callback for 500ms and flushes on close', async () => {
    vi.useFakeTimers();
    try {
      const onMutation = vi.fn();
      const persistence = adapter();
      const profiles = createDeviceCookieProfiles({ createCookies, persistence, onMutation });
      await profiles.configure(DEVICE_A, { persist: true, retentionDays: 30 });
      const cookies = createCookies();
      profiles.attach(DEVICE_A, cookies);
      cookies.setByServer('https://app.example/', ['one=1; Path=/']);
      cookies.setByServer('https://app.example/', ['two=2; Path=/']);

      expect(onMutation).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(499);
      expect(persistence.write).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(persistence.write).toHaveBeenCalledOnce();
      cookies.setByServer('https://app.example/', ['three=3; Path=/']);
      await profiles.close();
      expect(persistence.write).toHaveBeenCalledTimes(2);
      expect(persistence.write.mock.calls[1][1]).toContain('"key":"three"');
      expect(persistence.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears inactive memory and disk after retention but suppresses cleanup while active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      const persistence = adapter();
      const profiles = createDeviceCookieProfiles({ createCookies, persistence });
      await profiles.configure(DEVICE_A, { persist: true, retentionDays: 1 });
      const cookies = createCookies();
      profiles.attach(DEVICE_A, cookies);
      cookies.setByServer('https://app.example/', ['session=value; Path=/']);
      profiles.setActive(DEVICE_A, true);
      profiles.setActive(DEVICE_A, false);
      await vi.advanceTimersByTimeAsync(DAY - 1);
      profiles.setActive(DEVICE_A, true);
      await vi.advanceTimersByTimeAsync(1);
      expect(headerFor(cookies, 'https://app.example/')).toContain('session=value');
      profiles.setActive(DEVICE_A, false);
      await vi.advanceTimersByTimeAsync(DAY);

      expect(headerFor(cookies, 'https://app.example/')).toBeNull();
      expect(persistence.remove).toHaveBeenCalledWith(DEVICE_A);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears immediately when shorter retention is overdue and supports never', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      const persistence = adapter();
      const profiles = createDeviceCookieProfiles({ createCookies, persistence });
      await profiles.configure(DEVICE_A, { persist: true, retentionDays: 30 });
      await profiles.configure(DEVICE_B, { persist: true, retentionDays: null });
      const a = createCookies();
      const b = createCookies();
      profiles.attach(DEVICE_A, a);
      profiles.attach(DEVICE_B, b);
      a.setByServer('https://app.example/', ['session=a; Path=/']);
      b.setByServer('https://app.example/', ['session=b; Path=/']);
      for (const id of [DEVICE_A, DEVICE_B]) {
        profiles.setActive(id, true);
        profiles.setActive(id, false);
      }
      await vi.advanceTimersByTimeAsync(2 * DAY);

      await profiles.configure(DEVICE_A, { persist: true, retentionDays: 1 });
      await vi.advanceTimersByTimeAsync(363 * DAY);

      expect(headerFor(a, 'https://app.example/')).toBeNull();
      expect(headerFor(b, 'https://app.example/')).toContain('session=b');
      expect(persistence.remove).toHaveBeenCalledWith(DEVICE_A);
      expect(persistence.remove).not.toHaveBeenCalledWith(DEVICE_B);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('orders a full clear after an in-flight encrypted write', async () => {
  vi.useFakeTimers();
  try {
    const events = [];
    let finishWrite;
    const writePending = new Promise((resolve) => { finishWrite = resolve; });
    const persistence = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => { events.push('write'); await writePending; }),
      remove: vi.fn(async () => { events.push('remove'); }),
      close: vi.fn(),
    };
    const profiles = createDeviceCookieProfiles({ createCookies, persistence });
    await profiles.configure(DEVICE_A, { persist: true, retentionDays: 30 });
    const cookies = createCookies();
    profiles.attach(DEVICE_A, cookies);
    cookies.setByServer('https://app.example/', ['session=value; Path=/']);
    vi.advanceTimersByTime(500);
    await Promise.resolve();

    profiles.clear(DEVICE_A, {});
    expect(events).toEqual(['write']);
    finishWrite();
    await profiles.close();

    expect(events).toEqual(['write', 'remove']);
    expect(headerFor(cookies, 'https://app.example/')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

describe('device cookie profile concurrency', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  };

  it('does not let a deferred restore overwrite memory used while reading', async () => {
    const stale = createCookies();
    stale.setByServer('https://app.example/', ['session=stale; Path=/']);
    const reading = deferred();
    const persistence = {
      read: vi.fn(() => reading.promise),
      write: vi.fn(),
      remove: vi.fn(),
      close: vi.fn(),
    };
    const profiles = createDeviceCookieProfiles({ createCookies, persistence });
    const configuring = profiles.configure(DEVICE_A, { persist: true, retentionDays: 30 });
    const cookies = createCookies();
    profiles.attach(DEVICE_A, cookies);
    cookies.setByServer('https://app.example/', ['session=current; Path=/']);

    reading.resolve(stale.serializeJar());
    await configuring;

    expect(headerFor(cookies, 'https://app.example/')).toContain('session=current');
    expect(headerFor(cookies, 'https://app.example/')).not.toContain('session=stale');
    expect(persistence.write).toHaveBeenCalledOnce();
    expect(persistence.write.mock.calls[0][1]).toContain('"value":"current"');
  });

  it('rechecks the active epoch after waiting for an in-flight write', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      const writing = deferred();
      const persistence = {
        read: vi.fn(async () => null),
        write: vi.fn(() => writing.promise),
        remove: vi.fn(),
        close: vi.fn(),
      };
      const profiles = createDeviceCookieProfiles({ createCookies, persistence });
      await profiles.configure(DEVICE_A, { persist: true, retentionDays: 1 });
      const cookies = createCookies();
      profiles.attach(DEVICE_A, cookies);
      cookies.setByServer('https://app.example/', ['session=value; Path=/']);
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      profiles.setActive(DEVICE_A, true);
      profiles.setActive(DEVICE_A, false);
      vi.advanceTimersByTime(DAY);
      await Promise.resolve();

      profiles.setActive(DEVICE_A, true);
      writing.resolve();
      await profiles.close();

      expect(headerFor(cookies, 'https://app.example/')).toContain('session=value');
      expect(persistence.remove).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes full clear removal before a subsequent dirty flush', async () => {
    vi.useFakeTimers();
    try {
      const removing = deferred();
      const events = [];
      const persistence = {
        read: vi.fn(async () => null),
        write: vi.fn(async (_id, jar) => {
          events.push(jar.includes('"value":"new"') ? 'write-new' : 'write-old');
        }),
        remove: vi.fn(async () => {
          events.push('remove-start');
          await removing.promise;
          events.push('remove-end');
        }),
        close: vi.fn(),
      };
      const profiles = createDeviceCookieProfiles({ createCookies, persistence });
      await profiles.configure(DEVICE_A, { persist: true, retentionDays: 30 });
      const cookies = createCookies();
      profiles.attach(DEVICE_A, cookies);
      cookies.setByServer('https://app.example/', ['session=old; Path=/']);
      await vi.advanceTimersByTimeAsync(500);
      profiles.clear(DEVICE_A, {});
      cookies.setByServer('https://app.example/', ['session=new; Path=/']);
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();

      expect(events).toEqual(['write-old', 'remove-start']);
      removing.resolve();
      await profiles.close();

      expect(events).toEqual(['write-old', 'remove-start', 'remove-end', 'write-new']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for an in-flight configure restore before close resolves', async () => {
    const source = createCookies();
    source.setByServer('https://app.example/', ['session=restored; Path=/']);
    const reading = deferred();
    const persistence = {
      read: vi.fn(() => reading.promise),
      write: vi.fn(),
      remove: vi.fn(),
      close: vi.fn(),
    };
    const profiles = createDeviceCookieProfiles({ createCookies, persistence });
    const configuring = profiles.configure(DEVICE_A, { persist: true, retentionDays: 30 });
    const closing = profiles.close();
    let closed = false;
    closing.then(() => { closed = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);

    reading.resolve(source.serializeJar());
    await configuring;
    await closing;
    const cookies = createCookies();
    profiles.attach(DEVICE_A, cookies);

    expect(headerFor(cookies, 'https://app.example/')).toContain('session=restored');
    expect(persistence.close).toHaveBeenCalledOnce();
  });
});
