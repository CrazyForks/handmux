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
    const profiles = createDeviceCookieProfiles({ createCookies, onMutation });
    const cookies = createCookies();
    profiles.attach(DEVICE_A, cookies);
    cookies.setByServer('https://app-a.example/login', ['session=a; Path=/']);
    cookies.setByServer('https://app-b.example/login', ['session=b; Path=/']);
    onMutation.mockClear();

    expect(profiles.clear(DEVICE_A, { url: 'https://app-a.example/' })).toEqual({ cleared: true });

    expect(headerFor(cookies, 'https://app-a.example/')).toBeNull();
    expect(headerFor(cookies, 'https://app-b.example/')).toContain('session=b');
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
