import { describe, expect, it, vi } from 'vitest';
import hammerhead from 'testcafe-hammerhead';
import { createBrowserPreviewManager } from '../src/browser/manager.js';

function fakeHammerhead() {
  const proxies = [];
  class Session {
    constructor(_uploads, options) {
      this.id = 'generated';
      this.options = options;
      this.addRequestEventListeners = vi.fn(async (_rule, listeners) => { this.requestListeners = listeners; });
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
      this.openSession = vi.fn((url, session) => `${this.server1Info.domain}/${session.id}/${url}`);
      this.closeSession = vi.fn();
      this.close = vi.fn();
      proxies.push(this);
    }
  }
  return { api: { Proxy, Session, ResponseMock, RequestFilterRule: { ANY: { id: 'any' } } }, proxies };
}

describe('browser preview manager', () => {
  it('registers request hooks through the actual Hammerhead 31.7.8 session provider', async () => {
    const manager = await createBrowserPreviewManager({ hammerhead });
    try {
      const tab = manager.create({ url: 'https://example.com/', origin: 'https://handmux.example', closeAfterMinutes: 10 });
      expect(tab.url).toContain('/_browser-');
    } finally {
      manager.close();
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

    const a = manager.create({ url: 'https://a.example/', origin: 'https://handmux.example:30443', closeAfterMinutes: 10 });
    const b = manager.create({ url: 'https://b.example/', origin: 'https://handmux.example:30443', closeAfterMinutes: 30 });

    expect(fake.proxies).toHaveLength(1);
    expect(fake.proxies[0].start).toHaveBeenCalledWith(expect.objectContaining({
      hostname: '127.0.0.1', port1: 4311, port2: 4312, disableCrossDomain: true, disableHttp2: true,
    }));
    expect(a).toMatchObject({ id: 'tab-a', originalUrl: 'https://a.example/', visible: true, expiresAt: null });
    expect(a.channel).toBe('private-channel');
    expect(b).toMatchObject({ id: 'tab-b', originalUrl: 'https://b.example/', visible: true, expiresAt: null });
    expect(a.url).toContain('/_browser-tab-a/https://a.example/');
    expect(b.url).toContain('/_browser-tab-b/https://b.example/');
    expect(fake.proxies[0].openSession.mock.calls[0][1]).not.toBe(fake.proxies[0].openSession.mock.calls[1][1]);
  });

  it('adapts generated URLs to the current public Handmux origin', async () => {
    const fake = fakeHammerhead();
    const manager = await createBrowserPreviewManager({ hammerhead: fake.api, internalPorts: [4311, 4312], randomId: () => 'tab-a' });

    const tab = manager.create({ url: 'http://127.0.0.1:5173/', origin: 'https://phone.example:30443', closeAfterMinutes: 10 });

    expect(tab.url).toMatch(/^https:\/\/phone\.example:30443\/_browser-tab-a\//);
    expect(fake.proxies[0].server1Info).toMatchObject({
      hostname: 'phone.example', port: 30443, crossDomainPort: 30443, protocol: 'https:', domain: 'https://phone.example:30443',
    });
  });

  it('rejects a second public origin while live sessions exist', async () => {
    const fake = fakeHammerhead();
    const ids = ['tab-a', 'tab-b'];
    const manager = await createBrowserPreviewManager({ hammerhead: fake.api, internalPorts: [4311, 4312], randomId: () => ids.shift() });
    manager.create({ url: 'https://a.example/', origin: 'https://one.example', closeAfterMinutes: 10 });

    expect(() => manager.create({ url: 'https://b.example/', origin: 'https://two.example', closeAfterMinutes: 10 }))
      .toThrowError(/different Handmux origin/);
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
    manager.create({ url: 'https://a.example/', origin: 'https://handmux.example', closeAfterMinutes: 10 });
    manager.create({ url: 'https://b.example/', origin: 'https://handmux.example', closeAfterMinutes: 30 });
    manager.setVisible('tab-a', false, 10);
    manager.setVisible('tab-b', false, 30);

    timers[0]();

    expect(manager.get('tab-a')).toBeNull();
    expect(manager.get('tab-b')).not.toBeNull();
    expect(fake.proxies[0].closeSession).toHaveBeenCalledTimes(1);
    expect(fake.proxies[0].closeSession.mock.calls[0][0].id).toBe('_browser-tab-a');

    manager.close();
    expect(fake.proxies[0].closeSession).toHaveBeenCalledTimes(2);
    expect(fake.proxies[0].close).toHaveBeenCalledOnce();
  });

  it('reuses a tab session when navigating and exposes a channel-bound payload bridge', async () => {
    const fake = fakeHammerhead();
    const manager = await createBrowserPreviewManager({ hammerhead: fake.api, internalPorts: [4311, 4312], randomId: () => 'tab-a' });
    const first = manager.create({ url: 'https://a.example/', origin: 'https://handmux.example', closeAfterMinutes: 10 });
    const session = fake.proxies[0].openSession.mock.calls[0][1];

    const next = manager.navigate('tab-a', 'https://a.example/next');
    const payload = await session.getPayloadScript();

    expect(next).toMatchObject({ id: first.id, originalUrl: 'https://a.example/next' });
    expect(fake.proxies[0].openSession.mock.calls[1][1]).toBe(session);
    expect(payload).toContain(first.channel);
    expect(payload).toContain('postMessage');
    expect(payload).toContain('history.back');
    expect(payload).toContain('history.forward');
    expect(payload).toContain('location.reload');
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
    manager.create({ url: 'http://127.0.0.1:5173/', origin: 'https://handmux.example', closeAfterMinutes: 10 });

    manager.navigate('tab-a', 'http://127.0.0.1:3000/');

    expect(authorizeTopLevel).toHaveBeenCalledWith('http://127.0.0.1:3000/');
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
    manager.create({ url: 'https://portal.example/', origin: 'https://handmux.example', closeAfterMinutes: 10 });
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
});
