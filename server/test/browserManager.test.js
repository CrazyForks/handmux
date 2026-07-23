import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import hammerhead from 'testcafe-hammerhead';
import { createBrowserPreviewManager } from '../src/browser/manager.js';
const DEVICE = 'device-test';

function fakeHammerhead() {
  const proxies = [];
  let openSessionError = null;
  class Session {
    constructor(_uploads, options) {
      this.id = 'generated';
      this.options = options;
      this.addRequestEventListeners = vi.fn(async (_rule, listeners) => { this.requestListeners = listeners; });
      this.cookies = new hammerhead.Session([]).cookies;
    }
  }
  class ResponseMock {
    constructor(body, statusCode, headers) { Object.assign(this, { body, statusCode, headers }); }
  }
  class Proxy {
    constructor() {
      this.start = vi.fn((options) => {
        this.options = options;
        this.server1Info = { hostname: options.hostname, port: options.port1, crossDomainPort: options.port2, protocol: 'http:', domain: `http://${options.hostname}:${options.port1}` };
        this.server2Info = { hostname: options.hostname, port: options.port2, crossDomainPort: options.port1, protocol: 'http:', domain: `http://${options.hostname}:${options.port2}` };
      });
      this.windowIds = [];
      this.openSession = vi.fn((url, session) => {
        if (openSessionError) throw openSessionError;
        this.windowIds.push(session.options.windowId);
        return `${this.server1Info.domain}/${session.id}/${url}`;
      });
      this.closeSession = vi.fn();
      this.close = vi.fn();
      proxies.push(this);
    }
  }
  return {
    api: { Proxy, Session, ResponseMock, RequestFilterRule: { ANY: { id: 'any' } } },
    proxies,
    failOpenSession(error) { openSessionError = error; },
  };
}

describe('browser preview manager', () => {
  it('attaches cookie wrappers and exposes profile operations', async () => {
    const fake = fakeHammerhead();
    const detach = vi.fn();
    const cookieProfiles = {
      attach: vi.fn(() => detach),
      serialize: vi.fn(() => 'serialized'),
      clear: vi.fn(() => ({ cleared: true })),
    };
    const ids = ['tab-a', 'tab-b'];
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      cookieProfiles,
      randomId: () => ids.shift(),
    });

    const first = await manager.create({
      url: 'https://a.example/', origin: 'https://browser-a.preview.example', closeAfterMinutes: 10, deviceId: DEVICE,
    });
    await manager.create({
      url: 'https://b.example/', origin: 'https://browser-b.preview.example', closeAfterMinutes: 10, deviceId: DEVICE,
    });

    expect(cookieProfiles.attach).toHaveBeenCalledTimes(2);
    expect(cookieProfiles.attach.mock.calls[0][0]).toBe(DEVICE);
    manager.closeTab(first.id, DEVICE);
    expect(detach).toHaveBeenCalledTimes(1);
    expect(manager.serializeDeviceProfile(DEVICE)).toBe('serialized');
    expect(manager.clearDeviceProfile(DEVICE, { url: 'https://a.example/' })).toEqual({ cleared: true });

    await manager.close();
    expect(detach).toHaveBeenCalledTimes(2);
  });

  it('detaches an empty context exactly once when shutdown interrupts openSession', async () => {
    const fake = fakeHammerhead();
    const detach = vi.fn(() => {
      expect(fake.proxies[0].close).not.toHaveBeenCalled();
    });
    const cookieProfiles = {
      attach: vi.fn(() => detach),
      serialize: vi.fn(),
      clear: vi.fn(),
    };
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      cookieProfiles,
      randomId: () => 'tab-a',
    });
    const creating = manager.create({
      url: 'https://a.example/',
      origin: 'https://browser-a.preview.example',
      closeAfterMinutes: 10,
      deviceId: DEVICE,
    });
    fake.proxies[0].openSession.mockImplementation(() => {
      void manager.close();
      throw new Error('open interrupted');
    });

    await expect(creating).rejects.toThrow('open interrupted');
    await manager.close();

    expect(cookieProfiles.attach).toHaveBeenCalledOnce();
    expect(detach).toHaveBeenCalledOnce();
    expect(fake.proxies[0].closeSession).toHaveBeenCalledOnce();
  });

  it('creates a direct tab without allocating a Hammerhead context', async () => {
    const fake = fakeHammerhead();
    const target = 'https://direct.example/path';
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      randomId: () => 'tab-direct',
      randomChannel: () => 'direct-channel',
    });

    const tab = await manager.create({
      url: target,
      origin: 'https://handmux.example',
      closeAfterMinutes: 10,
      deviceId: DEVICE,
      mode: 'direct',
    });

    expect(tab).toMatchObject({ mode: 'direct', url: target, originalUrl: target });
    expect(manager.list(DEVICE)[0]).toMatchObject({ mode: 'direct', url: target, originalUrl: target });
    expect(fake.proxies).toHaveLength(0);
  });

  it('rejects a direct create after manager shutdown', async () => {
    const fake = fakeHammerhead();
    const manager = await createBrowserPreviewManager({ hammerhead: fake.api });
    await manager.close();

    await expect(manager.create({
      url: 'https://direct.example/',
      origin: 'https://handmux.example',
      closeAfterMinutes: 10,
      deviceId: DEVICE,
      mode: 'direct',
    })).rejects.toThrow(/closing/);
  });

  it('keeps missing create mode compatible with proxy tabs', async () => {
    const fake = fakeHammerhead();
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      randomId: () => 'tab-legacy',
    });

    await manager.create({
      url: 'https://legacy.example/', origin: 'https://handmux.example', closeAfterMinutes: 10, deviceId: DEVICE,
    });

    expect(manager.get('tab-legacy', DEVICE).mode).toBe('proxy');
    expect(fake.proxies[0].openSession).toHaveBeenCalledOnce();
  });

  it('switches a proxy tab to direct before releasing its Hammerhead context', async () => {
    const fake = fakeHammerhead();
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      randomId: () => 'tab-a',
    });
    const first = await manager.create({
      url: 'https://proxy.example/', origin: 'https://handmux.example', closeAfterMinutes: 10, deviceId: DEVICE,
    });
    fake.proxies[0].closeSession.mockImplementation(() => {
      expect(manager.get(first.id, DEVICE)).toMatchObject({
        mode: 'direct', url: 'https://direct.example/', originalUrl: 'https://direct.example/',
      });
    });

    const next = await manager.navigate(
      first.id, 'https://direct.example/', DEVICE, 'https://handmux.example', 'direct',
    );

    expect(next).toMatchObject({ id: first.id, mode: 'direct', url: 'https://direct.example/' });
    expect(fake.proxies[0].openSession).toHaveBeenCalledOnce();
    expect(fake.proxies[0].closeSession).toHaveBeenCalledOnce();
  });

  it('keeps a direct tab unchanged when switching to proxy cannot open a session', async () => {
    const fake = fakeHammerhead();
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      randomId: () => 'tab-a',
    });
    const first = await manager.create({
      url: 'https://direct.example/', origin: 'https://handmux.example', closeAfterMinutes: 10, deviceId: DEVICE, mode: 'direct',
    });
    fake.failOpenSession(new Error('open failed'));
    const navigating = manager.navigate(
      first.id, 'https://proxy.example/', DEVICE, 'https://handmux.example', 'proxy',
    );

    await expect(navigating).rejects.toThrow('open failed');
    expect(manager.get(first.id, DEVICE)).toMatchObject({
      id: first.id, mode: 'direct', url: 'https://direct.example/', originalUrl: 'https://direct.example/',
    });
    expect(fake.proxies[0].closeSession).toHaveBeenCalledOnce();
  });

  it('registers request hooks through the actual Hammerhead 31.7.8 session provider', async () => {
    const manager = await createBrowserPreviewManager({ hammerhead });
    try {
      const tab = await manager.create({ url: 'https://example.com/', origin: 'https://handmux.example', closeAfterMinutes: 10, deviceId: DEVICE });
      expect(tab.url).toContain('/_browser-');
    } finally {
      await manager.close();
    }
  });

  it('starts one proxy and creates an isolated Hammerhead session per tab', async () => {
    const fake = fakeHammerhead();
    const ids = ['tab-a', 'tab-b'];
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      internalPorts: [4311, 4312],
      randomId: () => ids.shift(),
      randomChannel: () => 'private-channel',
    });

    const a = await manager.create({ url: 'https://target.example/a', origin: 'https://handmux.example:30443', closeAfterMinutes: 10, deviceId: 'device-a' });
    const b = await manager.create({ url: 'https://target.example/b', origin: 'https://handmux.example:30443', closeAfterMinutes: 30, deviceId: 'device-b' });

    expect(fake.proxies).toHaveLength(1);
    expect(fake.proxies[0].start).toHaveBeenCalledWith(expect.objectContaining({
      hostname: '127.0.0.1', port1: 4311, port2: 4312, disableCrossDomain: true, disableHttp2: true,
    }));
    expect(a).toMatchObject({ id: 'tab-a', originalUrl: 'https://target.example/a', visible: true, expiresAt: null });
    expect(a.channel).toBe('private-channel');
    expect(b).toMatchObject({ id: 'tab-b', originalUrl: 'https://target.example/b', visible: true, expiresAt: null });
    expect(a.url).toContain('/_browser-tab-a/https://target.example/a');
    expect(b.url).toContain('/_browser-tab-b/https://target.example/b');
    expect(fake.proxies[0].openSession.mock.calls[0][1]).not.toBe(fake.proxies[0].openSession.mock.calls[1][1]);
    expect(manager.list('device-a').map((tab) => tab.id)).toEqual(['tab-a']);
    expect(manager.list('device-b').map((tab) => tab.id)).toEqual(['tab-b']);
    expect(manager.get('tab-a', 'device-b')).toBeNull();
    expect(manager.ownsPublicPath(new URL(a.url).pathname, 'device-b')).toBe(false);
    expect(manager.ownsPublicPath(new URL(a.url).pathname, 'device-a')).toBe(true);
  });

  it('shares one Hammerhead session for the same device and target origin until its final tab closes', async () => {
    const fake = fakeHammerhead();
    const ids = ['tab-a', 'tab-b'];
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      internalPorts: [4311, 4312],
      randomId: () => ids.shift(),
    });

    const first = await manager.create({
      url: 'https://target.example/a', origin: 'https://browser-target.preview.example', closeAfterMinutes: 10, deviceId: DEVICE,
    });
    const second = await manager.create({
      url: 'https://target.example/b', origin: 'https://browser-target.preview.example', closeAfterMinutes: 10, deviceId: DEVICE,
    });

    expect(fake.proxies).toHaveLength(1);
    expect(fake.proxies[0].openSession.mock.calls[0][1]).toBe(fake.proxies[0].openSession.mock.calls[1][1]);
    expect(fake.proxies[0].windowIds).toHaveLength(2);
    expect(fake.proxies[0].windowIds[0]).not.toBe(fake.proxies[0].windowIds[1]);
    expect(first.channel).not.toBe(second.channel);
    expect(new URL(first.url).origin).toBe(new URL(second.url).origin);
    expect(second._displacedTabs).toEqual([{ id: first.id, closeAfterMinutes: 10 }]);
    expect(Object.keys(second)).not.toContain('_displacedTabs');

    manager.closeTab(first.id, DEVICE);
    expect(fake.proxies[0].closeSession).not.toHaveBeenCalled();
    manager.closeTab(second.id, DEVICE);
    expect(fake.proxies[0].closeSession).toHaveBeenCalledOnce();
  });

  it('adapts generated URLs to the current public Handmux origin', async () => {
    const fake = fakeHammerhead();
    const manager = await createBrowserPreviewManager({ hammerhead: fake.api, internalPorts: [4311, 4312], randomId: () => 'tab-a' });

    const tab = await manager.create({ url: 'http://127.0.0.1:5173/', origin: 'https://phone.example:30443', closeAfterMinutes: 10, deviceId: DEVICE });

    expect(tab.url).toMatch(/^https:\/\/phone\.example:30443\/_browser-tab-a\//);
    expect(fake.proxies[0].server1Info).toMatchObject({
      hostname: 'phone.example', port: 30443, crossDomainPort: 30443, protocol: 'https:', domain: 'https://phone.example:30443',
    });
  });

  it('keeps independent proxy pools for two live public Handmux origins', async () => {
    const fake = fakeHammerhead();
    const ids = ['tab-a', 'tab-b'];
    const manager = await createBrowserPreviewManager({ hammerhead: fake.api, internalPorts: [4311, 4312], randomId: () => ids.shift() });
    const [first, second] = await Promise.all([
      manager.create({ url: 'https://a.example/', origin: 'https://one.example', closeAfterMinutes: 10, deviceId: 'device-one' }),
      manager.create({ url: 'https://b.example/', origin: 'https://two.example', closeAfterMinutes: 10, deviceId: 'device-two' }),
    ]);

    expect(first.url).toMatch(/^https:\/\/one\.example\//);
    expect(second.url).toMatch(/^https:\/\/two\.example\//);
    expect(fake.proxies).toHaveLength(2);
    expect(fake.proxies[0].start).toHaveBeenCalledWith(expect.objectContaining({ port1: 4311, port2: 4312 }));
    expect(fake.proxies[1].start).toHaveBeenCalledWith(expect.objectContaining({ port1: 0, port2: 0 }));
    expect(fake.proxies[0].closeSession).not.toHaveBeenCalled();
    expect(fake.proxies[1].closeSession).not.toHaveBeenCalled();
  });

  it('keeps public origin collision claims after the final context closes', async () => {
    const fake = fakeHammerhead();
    const ids = ['tab-a', 'tab-b'];
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      randomId: () => ids.shift(),
    });
    const first = await manager.create({
      url: 'https://a.example/',
      origin: 'https://b-fixed.preview.example',
      closeAfterMinutes: 10,
      deviceId: DEVICE,
    });
    manager.closeTab(first.id, DEVICE);

    await expect(manager.create({
      url: 'https://b.example/',
      origin: 'https://b-fixed.preview.example',
      closeAfterMinutes: 10,
      deviceId: DEVICE,
    })).rejects.toThrow('browser public origin collision');
  });

  it('routes the same device only within the matching public origin', async () => {
    const fake = fakeHammerhead();
    const ids = ['tab-a', 'tab-b'];
    const manager = await createBrowserPreviewManager({ hammerhead: fake.api, internalPorts: [4311, 4312], randomId: () => ids.shift() });
    const first = await manager.create({ url: 'https://a.example/', origin: 'https://one.example', closeAfterMinutes: 10, deviceId: DEVICE });
    const second = await manager.create({ url: 'https://b.example/', origin: 'https://two.example', closeAfterMinutes: 10, deviceId: DEVICE });

    expect(manager.resolvePublicRequest('/task.js', DEVICE, 'https://one.example')).toMatchObject({ port: 4311 });
    expect(manager.resolvePublicRequest('/task.js', DEVICE, 'https://two.example')).toMatchObject({ port: 0 });
    expect(manager.resolvePublicRequest(new URL(first.url).pathname, DEVICE, 'https://one.example')).toMatchObject({ port: 4311 });
    expect(manager.resolvePublicRequest(new URL(first.url).pathname, DEVICE, 'https://two.example')).toBeNull();
    expect(manager.resolvePublicRequest(new URL(second.url).pathname, DEVICE, 'https://one.example')).toBeNull();
  });

  it('closes a proxy that is still starting when manager shutdown begins', async () => {
    const fake = fakeHammerhead();
    class PendingProxy extends fake.api.Proxy {
      constructor() {
        super();
        this.server1 = new EventEmitter();
        this.server1.listening = false;
        this.server2 = new EventEmitter();
        this.server2.listening = false;
        this.close.mockImplementation(() => {
          this.server1.emit('close');
          this.server2.emit('close');
        });
      }
    }
    const manager = await createBrowserPreviewManager({ hammerhead: { ...fake.api, Proxy: PendingProxy } });
    const creating = manager.create({ url: 'https://a.example/', origin: 'https://one.example', closeAfterMinutes: 10, deviceId: DEVICE });

    await manager.close();

    await expect(creating).rejects.toThrow(/closing/);
    expect(fake.proxies[0].close).toHaveBeenCalled();
    await expect(manager.create({ url: 'https://b.example/', origin: 'https://two.example', closeAfterMinutes: 10, deviceId: DEVICE })).rejects.toThrow(/closing/);
  });

  it('rejects a create that was reusing an existing context when shutdown wins the race', async () => {
    const fake = fakeHammerhead();
    const ids = ['tab-a', 'tab-b'];
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      internalPorts: [4311, 4312],
      randomId: () => ids.shift(),
    });
    await manager.create({
      url: 'https://target.example/a', origin: 'https://browser-target.preview.example', closeAfterMinutes: 10, deviceId: DEVICE,
    });

    const creating = manager.create({
      url: 'https://target.example/b', origin: 'https://browser-target.preview.example', closeAfterMinutes: 10, deviceId: DEVICE,
    });
    await manager.close();

    await expect(creating).rejects.toThrow(/closing/);
    expect(manager.list(DEVICE)).toEqual([]);
    expect(fake.proxies[0].closeSession).toHaveBeenCalledOnce();
  });

  it('closes only the expired tab session and closes all remaining sessions at shutdown', async () => {
    const fake = fakeHammerhead();
    const timers = [];
    const ids = ['tab-a', 'tab-b'];
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      internalPorts: [4311, 4312],
      randomId: () => ids.shift(),
      setTimer: (fn) => { timers.push(fn); return timers.length; },
      clearTimer: vi.fn(),
    });
    await manager.create({ url: 'https://target.example/a', origin: 'https://handmux.example', closeAfterMinutes: 10, deviceId: 'device-a' });
    await manager.create({ url: 'https://target.example/b', origin: 'https://handmux.example', closeAfterMinutes: 30, deviceId: 'device-b' });
    manager.setVisible('tab-a', false, 10, 'device-a');
    manager.setVisible('tab-b', false, 30, 'device-b');

    timers[0]();

    expect(manager.get('tab-a', 'device-a')).toBeNull();
    expect(manager.get('tab-b', 'device-b')).not.toBeNull();
    expect(fake.proxies[0].closeSession).toHaveBeenCalledTimes(1);
    expect(fake.proxies[0].closeSession.mock.calls[0][0].id).toBe('_browser-tab-a');

    await manager.close();
    expect(fake.proxies[0].closeSession).toHaveBeenCalledTimes(2);
    expect(fake.proxies[0].close).toHaveBeenCalledOnce();
  });

  it('keeps at most one visible tab per device when tabs are created or shown', async () => {
    const fake = fakeHammerhead();
    const ids = ['tab-a', 'tab-b'];
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      internalPorts: [4311, 4312],
      randomId: () => ids.shift(),
    });
    await manager.create({ url: 'https://a.example/', origin: 'https://handmux.example', closeAfterMinutes: 10, deviceId: DEVICE });
    await manager.create({ url: 'https://b.example/', origin: 'https://b.handmux.example', closeAfterMinutes: 10, deviceId: DEVICE });

    expect(manager.list(DEVICE).filter((tab) => tab.visible).map((tab) => tab.id)).toEqual(['tab-b']);

    manager.setVisible('tab-a', true, 10, DEVICE);

    expect(manager.list(DEVICE).filter((tab) => tab.visible).map((tab) => tab.id)).toEqual(['tab-a']);
    expect(manager.get('tab-b', DEVICE)).toMatchObject({ visible: false, closeAfterMinutes: 10 });
  });

  it('reuses a tab session when navigating and exposes a channel-bound payload bridge', async () => {
    const fake = fakeHammerhead();
    const manager = await createBrowserPreviewManager({ hammerhead: fake.api, internalPorts: [4311, 4312], randomId: () => 'tab-a' });
    const first = await manager.create({ url: 'https://a.example/', origin: 'https://handmux.example', closeAfterMinutes: 10, deviceId: DEVICE });
    const session = fake.proxies[0].openSession.mock.calls[0][1];

    const next = await manager.navigate('tab-a', 'https://a.example/next', DEVICE, 'https://handmux.example');
    const payload = await session.getPayloadScript(first.channel);

    expect(next).toMatchObject({ id: first.id, originalUrl: 'https://a.example/next' });
    expect(fake.proxies[0].openSession.mock.calls[1][1]).toBe(session);
    expect(payload).toContain(first.channel);
    expect(payload).toContain('postMessage');
    expect(payload).toContain('history.back');
    expect(payload).toContain('history.forward');
    expect(payload).toContain('location.reload');
    expect(payload).toContain('window.stop()');
    expect(payload).toContain('pageNavigationTriggered');
    expect(payload).toContain('parseProxyUrl');
    expect(payload).toContain("addEventListener('popstate', () => send('urlchange'))");
    expect(payload).toContain("addEventListener('hashchange', () => send('urlchange'))");
    expect(payload).toContain("for (const name of ['pushState', 'replaceState'])");
    expect(payload).toContain("send('urlchange')");
    expect(payload).toContain("send('navigate', url)");
    expect(payload).toContain("addEventListener('DOMContentLoaded', observeTitle");
    expect(payload).toContain('observer.observe(document.head');
    expect(payload).toContain('if (title === lastTitle && url === lastTitleUrl) return');
    expect(await session.getIframePayloadScript()).toBe('');
  });

  it('authorizes the new top-level loopback origin before navigating an existing tab', async () => {
    const fake = fakeHammerhead();
    const authorizeTopLevel = vi.fn();
    const targetPolicyFactory = vi.fn(() => ({ check: vi.fn(), authorizeTopLevel }));
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      internalPorts: [4311, 4312],
      randomId: () => 'tab-a',
      targetPolicyFactory,
    });
    await manager.create({ url: 'http://127.0.0.1:5173/', origin: 'https://handmux.example', closeAfterMinutes: 10, deviceId: DEVICE });

    await manager.navigate('tab-a', 'http://127.0.0.1:3000/', DEVICE, 'https://browser-port-3000.example');

    expect(authorizeTopLevel).toHaveBeenCalledWith('http://127.0.0.1:3000/');
  });

  it('moves a tab to another device-origin session when its target origin changes', async () => {
    const fake = fakeHammerhead();
    const ids = ['tab-a', 'session-b'];
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      internalPorts: [4311, 4312],
      randomId: () => ids.shift(),
    });
    const first = await manager.create({
      url: 'https://a.example/', origin: 'https://browser-a.preview.example', closeAfterMinutes: 10, deviceId: DEVICE,
    });

    const next = await manager.navigate(
      first.id,
      'https://b.example/',
      DEVICE,
      'https://browser-b.preview.example',
    );

    expect(next.url).toMatch(/^https:\/\/browser-b\.preview\.example\//);
    expect(fake.proxies).toHaveLength(2);
    expect(fake.proxies[0].closeSession).toHaveBeenCalledOnce();
    expect(fake.proxies[1].openSession).toHaveBeenCalledOnce();
  });

  it('releases an intermediate context when two cross-origin navigations race', async () => {
    const fake = fakeHammerhead();
    const ids = ['tab-a', 'session-b', 'session-c'];
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      internalPorts: [4311, 4312],
      randomId: () => ids.shift(),
    });
    const tab = await manager.create({
      url: 'https://a.example/', origin: 'https://browser-a.preview.example', closeAfterMinutes: 10, deviceId: DEVICE,
    });

    await Promise.all([
      manager.navigate(tab.id, 'https://b.example/', DEVICE, 'https://browser-b.preview.example'),
      manager.navigate(tab.id, 'https://c.example/', DEVICE, 'https://browser-c.preview.example'),
    ]);
    manager.closeTab(tab.id, DEVICE);

    expect(fake.proxies).toHaveLength(3);
    expect(fake.proxies.every((proxy) => proxy.closeSession.mock.calls.length === 1)).toBe(true);
  });

  it('checks every destination request and replaces blocked targets with a specific 403', async () => {
    const fake = fakeHammerhead();
    const check = vi.fn()
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, reason: 'link-local' });
    const targetPolicyFactory = vi.fn(() => ({ check }));
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      internalPorts: [4311, 4312],
      randomId: () => 'tab-a',
      targetPolicyFactory,
    });
    await manager.create({ url: 'https://portal.example/', origin: 'https://handmux.example', closeAfterMinutes: 10, deviceId: DEVICE });
    const session = fake.proxies[0].openSession.mock.calls[0][1];
    const allowedEvent = { _requestInfo: { url: 'https://cdn.example/app.js' }, setMock: vi.fn() };
    const blockedEvent = { _requestInfo: { url: 'http://169.254.169.254/' }, setMock: vi.fn() };

    await session.requestListeners.onRequest(allowedEvent);
    await session.requestListeners.onRequest(blockedEvent);

    expect(targetPolicyFactory).toHaveBeenCalledWith({
      topLevelUrl: 'https://portal.example/', handmuxOrigin: 'https://handmux.example',
    });
    expect(allowedEvent.setMock).not.toHaveBeenCalled();
    expect(blockedEvent.setMock).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(blockedEvent.setMock.mock.calls[0][0].body).toMatch(/link-local/);
  });

  it('pins an allowed request to the DNS address checked by the target policy', async () => {
    const fake = fakeHammerhead();
    const check = vi.fn().mockResolvedValue({ allowed: true, address: '10.20.30.40', family: 4 });
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      internalPorts: [4311, 4312],
      randomId: () => 'tab-a',
      targetPolicyFactory: () => ({ check }),
    });
    await manager.create({ url: 'https://portal.example/', origin: 'https://handmux.example', closeAfterMinutes: 10, deviceId: DEVICE });
    const session = fake.proxies[0].openSession.mock.calls[0][1];
    const event = {
      _requestInfo: { url: 'https://cdn.example/app.js' },
      requestOptions: {},
      setMock: vi.fn(),
    };

    await session.requestListeners.onRequest(event);

    expect(event.requestOptions.lookup).toEqual(expect.any(Function));
    await expect(new Promise((resolve, reject) => {
      event.requestOptions.lookup('cdn.example', {}, (error, address, family) => {
        if (error) reject(error);
        else resolve({ address, family });
      });
    })).resolves.toEqual({ address: '10.20.30.40', family: 4 });
    await expect(new Promise((resolve, reject) => {
      event.requestOptions.lookup('cdn.example', { all: true }, (error, addresses) => {
        if (error) reject(error);
        else resolve(addresses);
      });
    })).resolves.toEqual([{ address: '10.20.30.40', family: 4 }]);
  });
});

describe('browser manager profile persistence lifecycle', () => {
  it('marks only proxy-tab activity and awaits profile close', async () => {
    const fake = fakeHammerhead();
    let finishClose;
    const closePending = new Promise((resolve) => { finishClose = resolve; });
    const cookieProfiles = {
      attach: vi.fn(() => vi.fn()),
      serialize: vi.fn(),
      clear: vi.fn(),
      configure: vi.fn(),
      setActive: vi.fn(),
      close: vi.fn(() => closePending),
    };
    const ids = ['proxy-a', 'direct-b'];
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      cookieProfiles,
      randomId: () => ids.shift(),
    });

    const proxy = await manager.create({
      url: 'https://proxy.example/', origin: 'https://handmux.example',
      closeAfterMinutes: 10, deviceId: DEVICE,
    });
    await manager.create({
      url: 'https://direct.example/', origin: 'https://handmux.example',
      closeAfterMinutes: 10, deviceId: DEVICE, mode: 'direct',
    });
    expect(cookieProfiles.setActive.mock.calls).toEqual([[DEVICE, true]]);

    await manager.navigate(proxy.id, 'https://direct.example/next', DEVICE, 'https://handmux.example', 'direct');
    expect(cookieProfiles.setActive).toHaveBeenLastCalledWith(DEVICE, false);
    const closing = manager.close();
    let closed = false;
    closing.then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    finishClose();
    await closing;
    expect(cookieProfiles.close).toHaveBeenCalledOnce();
  });

  it('marks a device inactive after its final proxy tab expires', async () => {
    const fake = fakeHammerhead();
    const timers = [];
    const cookieProfiles = {
      attach: vi.fn(() => vi.fn()),
      serialize: vi.fn(),
      clear: vi.fn(),
      configure: vi.fn(),
      setActive: vi.fn(),
      close: vi.fn(),
    };
    const manager = await createBrowserPreviewManager({
      hammerhead: fake.api,
      cookieProfiles,
      randomId: () => 'proxy-a',
      setTimer: (fn) => { timers.push(fn); return timers.length; },
      clearTimer: vi.fn(),
    });
    await manager.create({
      url: 'https://proxy.example/', origin: 'https://handmux.example',
      closeAfterMinutes: 10, deviceId: DEVICE,
    });
    manager.setVisible('proxy-a', false, 10, DEVICE);
    timers[0]();

    expect(cookieProfiles.setActive).toHaveBeenLastCalledWith(DEVICE, false);
    await manager.close();
  });

  it('keeps default persistence off and restores encrypted cookies across managers when enabled', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'handmux-manager-profile-'));
    const profileDir = path.join(root, 'profiles');
    try {
      const disabledFake = fakeHammerhead();
      const disabled = await createBrowserPreviewManager({
        hammerhead: disabledFake.api, profileDir, randomId: () => 'disabled',
      });
      await disabled.create({
        url: 'https://app.example/', origin: 'https://handmux.example',
        closeAfterMinutes: 10, deviceId: DEVICE,
      });
      disabledFake.proxies[0].openSession.mock.calls[0][1].cookies
        .setByServer('https://app.example/', ['disabled=value; Path=/']);
      await disabled.close();
      await expect(fs.stat(profileDir)).rejects.toMatchObject({ code: 'ENOENT' });

      const firstFake = fakeHammerhead();
      const first = await createBrowserPreviewManager({
        hammerhead: firstFake.api, profileDir, randomId: () => 'first',
      });
      await first.configureDeviceProfile(DEVICE, { persist: true, retentionDays: 7 });
      await first.create({
        url: 'https://app.example/', origin: 'https://handmux.example',
        closeAfterMinutes: 10, deviceId: DEVICE,
      });
      firstFake.proxies[0].openSession.mock.calls[0][1].cookies
        .setByServer('https://app.example/', ['session=restored; Path=/']);
      await first.close();

      const secondFake = fakeHammerhead();
      const second = await createBrowserPreviewManager({
        hammerhead: secondFake.api, profileDir, randomId: () => 'second',
      });
      await second.configureDeviceProfile(DEVICE, { persist: true, retentionDays: 7 });
      await second.create({
        url: 'https://app.example/', origin: 'https://handmux.example',
        closeAfterMinutes: 10, deviceId: DEVICE,
      });
      const restored = secondFake.proxies[0].openSession.mock.calls[0][1].cookies;
      expect(headerFor(restored, 'https://app.example/')).toContain('session=restored');
      await second.close();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

function headerFor(cookies, url) {
  return cookies.getHeader({ url, hostname: new URL(url).hostname });
}
