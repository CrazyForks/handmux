import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import * as importedHammerhead from 'testcafe-hammerhead';
import { createDeviceCookieProfiles } from './cookieProfiles.js';
import { createBrowserProfilePersistence } from './profilePersistence.js';
import { claimPublicOrigin } from './originLabel.js';
import { browserLabelForOrigin } from './originLabel.js';
import { createBrowserTargetPolicy } from './targetPolicy.js';
import {
  hammerheadRebindHeaders,
  installHammerheadRebindLocationCompat,
} from './hammerheadRedirectCompat.js';

const defaultHammerhead = importedHammerhead.default || importedHammerhead;

function normalizedOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('browser origin must use http or https');
  return url.origin;
}

function normalizedTarget(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('browser URL must use http or https');
  return url.toString();
}

function isLoopbackUrl(raw) {
  const hostname = new URL(raw).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.');
}

function bridgeScript(channel) {
  const encoded = JSON.stringify(channel);
  return `(() => {
    const channel = ${encoded};
    const hammerhead = window['%hammerhead%'];
    const destinationUrl = (url) => {
      try { return hammerhead?.utils?.url?.parseProxyUrl(url)?.destUrl || url; }
      catch { return url; }
    };
    const send = (type, url) => parent.postMessage({ source: 'handmux-browser', channel, type, url: url === undefined ? destinationUrl(location.href) : url, title: document.title }, '*');
    let pending = false;
    const activity = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; send('activity'); }, 250);
    };
    for (const name of ['pointerdown', 'keydown', 'input', 'scroll']) addEventListener(name, activity, { capture: true, passive: true });
    addEventListener('load', () => send('load'));
    addEventListener('popstate', () => send('urlchange'));
    addEventListener('hashchange', () => send('urlchange'));
    for (const name of ['pushState', 'replaceState']) {
      const original = history[name];
      history[name] = function (...args) {
        const result = original.apply(this, args);
        send('urlchange');
        return result;
      };
    }
    addEventListener('pagehide', () => send('navigate'));
    let lastTitle;
    let lastTitleUrl;
    const sendTitle = () => {
      const title = document.title;
      const url = destinationUrl(location.href);
      if (title === lastTitle && url === lastTitleUrl) return;
      lastTitle = title;
      lastTitleUrl = url;
      send('title', url);
    };
    const observeTitle = () => {
      if (!document.head) return;
      const observer = new MutationObserver(sendTitle);
      observer.observe(document.head, { subtree: true, childList: true, characterData: true });
      sendTitle();
    };
    if (document.head) observeTitle();
    else addEventListener('DOMContentLoaded', observeTitle, { once: true });
    addEventListener('message', (event) => {
      if (event.source !== parent || event.data?.source !== 'handmux-browser-parent' || event.data?.channel !== channel) return;
      if (event.data.command === 'back') history.back();
      else if (event.data.command === 'forward') history.forward();
      else if (event.data.command === 'reload') location.reload();
      else if (event.data.command === 'stop') window.stop();
    });
    send('ready');
  })();`;
}

function browserSessionClass(hammerhead) {
  return class BrowserSession extends hammerhead.Session {
    constructor(channel) {
      super([], {
        disablePageCaching: true,
        allowMultipleWindows: true,
        windowId: channel,
        requestTimeout: { page: 30_000, ajax: 30_000 },
        nativeAutomation: false,
      });
      this.channel = channel;
    }

    async getPayloadScript() { return bridgeScript(this.channel); }
    async getIframePayloadScript() { return ''; }
    getAuthCredentials() { return null; }
    handleAttachment() {}
    handleFileDownload() {}
    handlePageError() {}
  };
}

function applyPublicOrigin(proxy, origin) {
  const url = new URL(origin);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  for (const info of [proxy.server1Info, proxy.server2Info]) {
    info.hostname = url.hostname;
    info.port = port;
    info.crossDomainPort = port;
    info.protocol = url.protocol;
    info.domain = url.origin;
  }
}

async function waitForListening(server) {
  if (!server || server.listening || typeof server.once !== 'function') return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      server.removeListener('listening', onListening);
      server.removeListener('error', onError);
      server.removeListener('close', onClose);
    };
    const onListening = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error('browser manager closing')); };
    server.once('listening', onListening);
    server.once('error', onError);
    server.once('close', onClose);
  });
}

function publicLease(lease) {
  if (!lease) return null;
  return {
    tabId: lease.tabId,
    url: lease.url,
    originalUrl: lease.originalUrl,
    channel: lease.channel,
  };
}

export async function createBrowserPreviewManager({
  hammerhead = defaultHammerhead,
  internalPorts = [0, 0],
  randomId = () => randomBytes(18).toString('base64url'),
  randomChannel = () => randomBytes(18).toString('base64url'),
  targetPolicyFactory = createBrowserTargetPolicy,
  handmuxOrigin = 'http://127.0.0.1',
  previewDomain = null,
  browserBootstrap = null,
  cookieProfiles: suppliedCookieProfiles,
  profilePersistence: suppliedProfilePersistence,
  profileDir = path.join(os.homedir(), '.handmux', 'browser-profiles'),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  leaseTtlMs = 2 * 60 * 60 * 1000,
} = {}) {
  installHammerheadRebindLocationCompat();
  const ProxyClass = hammerhead.Proxy;
  const SessionClass = browserSessionClass(hammerhead);
  const profilePersistence = suppliedProfilePersistence || createBrowserProfilePersistence({
    dir: profileDir,
    keyFile: path.join(profileDir, 'profile.key'),
  });
  try {
    await profilePersistence.pruneExpiredProfiles?.();
  } catch (error) {
    console.warn(`[handmux] browser profile retention cleanup deferred: ${error?.message || error}`);
  }
  const cookieProfiles = suppliedCookieProfiles || createDeviceCookieProfiles({
    createCookies: () => new SessionClass('').cookies,
    persistence: profilePersistence,
    setTimer,
    clearTimer,
  });
  const pools = new Map();
  const pendingPools = new Map();
  const leases = new Map();
  const leaseQueues = new Map();
  const publicOriginClaims = new Map();
  let poolCount = 0;
  let closing = false;
  let rehomeNavigation = async () => false;

  const leaseKey = (deviceId, tabId) => `${deviceId}\u0000${tabId}`;
  const publicOriginFor = (target) => {
    if (!previewDomain) return null;
    const base = new URL(/^https?:\/\//i.test(previewDomain) ? previewDomain : `https://${previewDomain}`);
    base.hostname = `${browserLabelForOrigin(new URL(target).origin)}.${base.hostname}`;
    return base.origin;
  };
  const serializeLease = (key, operation) => {
    const previous = leaseQueues.get(key) || Promise.resolve();
    const current = previous.then(operation);
    const queued = current.catch(() => {});
    leaseQueues.set(key, queued);
    return current.finally(() => {
      if (leaseQueues.get(key) === queued) leaseQueues.delete(key);
    });
  };
  const poolFor = async (origin) => {
    if (pools.has(origin)) return pools.get(origin);
    if (pendingPools.has(origin)) return pendingPools.get(origin);
    const pending = (async () => {
      const proxy = new ProxyClass();
      const ports = poolCount++ === 0 ? internalPorts : [0, 0];
      try {
        proxy.start({
          hostname: '127.0.0.1',
          port1: ports[0],
          port2: ports[1],
          disableCrossDomain: true,
          disableHttp2: true,
        });
        await Promise.all([waitForListening(proxy.server1), waitForListening(proxy.server2)]);
        if (closing) throw new Error('browser manager closing');
        applyPublicOrigin(proxy, origin);
        const pool = {
          origin,
          proxy,
          ports: [
            proxy.server1?.address?.()?.port ?? ports[0],
            proxy.server2?.address?.()?.port ?? ports[1],
          ],
        };
        pools.set(origin, pool);
        return pool;
      } catch (error) {
        proxy.close();
        throw error;
      }
    })();
    pendingPools.set(origin, pending);
    try {
      return await pending;
    } finally {
      if (pendingPools.get(origin) === pending) pendingPools.delete(origin);
    }
  };

  const setDeviceActive = (deviceId) => cookieProfiles.setActive?.(
    deviceId,
    [...leases.values()].some((lease) => lease.deviceId === deviceId),
  );
  const release = (lease) => {
    if (!lease || leases.get(lease.key) !== lease) return false;
    leases.delete(lease.key);
    if (lease.timer != null) clearTimer(lease.timer);
    lease.detachCookies();
    lease.pool.proxy.closeSession(lease.session);
    setDeviceActive(lease.deviceId);
    return true;
  };
  const touch = (lease) => {
    if (lease.timer != null) clearTimer(lease.timer);
    lease.timer = setTimer(() => release(lease), leaseTtlMs);
  };
  const createLease = async ({ tabId, deviceId, url, origin, channel }) => {
    if (closing) throw new Error('browser manager closing');
    const target = normalizedTarget(url);
    const publicOrigin = normalizedOrigin(origin);
    const targetOrigin = new URL(target).origin;
    claimPublicOrigin(publicOriginClaims, publicOrigin, targetOrigin);
    const pool = await poolFor(publicOrigin);
    if (closing) throw new Error('browser manager closing');
    const session = new SessionClass(channel);
    session.id = `_browser-${randomId()}-${encodeURIComponent(tabId)}`;
    const policy = targetPolicyFactory({ topLevelUrl: target, handmuxOrigin });
    const hooks = session.requestHookEventProvider || session;
    hooks.addRequestEventListeners(hammerhead.RequestFilterRule.ANY, {
      onRequest: async (event) => {
        if (await rehomeNavigation(event, session)) return;
        const result = await policy.check(event._requestInfo.url);
        if (result.allowed) {
          if (result.address && event.requestOptions) {
            event.requestOptions.lookup = (_hostname, options, callback) => {
              const approved = { address: result.address, family: result.family };
              if (options?.all) callback(null, [approved]);
              else callback(null, approved.address, approved.family);
            };
          }
          return;
        }
        await event.setMock(new hammerhead.ResponseMock(
          JSON.stringify({ error: 'browser target blocked', reason: result.reason }),
          403,
          { 'content-type': 'application/json; charset=utf-8' },
        ));
      },
    }, () => {});
    const detachCookies = cookieProfiles.attach(deviceId, session.cookies);
    let publicUrl;
    try {
      publicUrl = pool.proxy.openSession(target, session);
    } catch (error) {
      detachCookies();
      pool.proxy.closeSession(session);
      throw error;
    }
    return {
      key: leaseKey(deviceId, tabId),
      tabId,
      deviceId,
      originalUrl: target,
      url: publicUrl,
      publicOrigin,
      channel,
      pool,
      session,
      policy,
      detachCookies,
      timer: null,
    };
  };

  const putImpl = async ({ tabId, deviceId, url, origin }, requireExisting = false) => {
    if (!deviceId || !tabId) throw new Error('browser lease identity required');
    const key = leaseKey(deviceId, tabId);
    const existing = leases.get(key);
    if (requireExisting && !existing) return null;
    const target = normalizedTarget(url);
    const publicOrigin = normalizedOrigin(origin);
    if (existing && existing.originalUrl === target && existing.publicOrigin === publicOrigin) {
      touch(existing);
      return publicLease(existing);
    }
    const next = await createLease({
      tabId,
      deviceId,
      url: target,
      origin: publicOrigin,
      channel: existing?.channel || randomChannel(),
    });
    leases.set(key, next);
    touch(next);
    if (existing) {
      if (existing.timer != null) clearTimer(existing.timer);
      existing.detachCookies();
      existing.pool.proxy.closeSession(existing.session);
    }
    setDeviceActive(deviceId);
    return publicLease(next);
  };
  const put = ({ tabId, deviceId, ...options }, requireExisting = false) => {
    const key = leaseKey(deviceId, tabId);
    return serializeLease(key, () => putImpl(
      { tabId, deviceId, ...options },
      requireExisting,
    ));
  };

  rehomeNavigation = async (event, session) => {
    const info = event?._requestInfo || {};
    const headers = info.headers || {};
    const destination = String(headers['sec-fetch-dest'] || headers['Sec-Fetch-Dest'] || '').toLowerCase();
    const acceptsHtml = String(headers.accept || headers.Accept || '').toLowerCase().includes('text/html');
    const topLevelDocument = !info.isAjax && !info.isIframe
      && (destination === 'document' || destination === 'iframe' || acceptsHtml);
    if (!topLevelDocument) return false;
    let target;
    try { target = normalizedTarget(info.url); } catch { return false; }
    const observed = [...leases.values()].find((lease) => lease.session === session);
    if (!observed || new URL(target).origin === new URL(observed.originalUrl).origin) return false;
    const origin = publicOriginFor(target);
    if (!origin || !browserBootstrap) return false;

    return serializeLease(observed.key, async () => {
      const current = leases.get(observed.key);
      if (!current || current.session !== session) return false;
      const result = await current.policy.check(target);
      const loopbackPortChange = isLoopbackUrl(current.originalUrl)
        && isLoopbackUrl(target)
        && new URL(current.originalUrl).origin !== new URL(target).origin;
      if (!result.allowed || loopbackPortChange) {
        await event.setMock(new hammerhead.ResponseMock(
          JSON.stringify({
            error: 'browser target blocked',
            reason: loopbackPortChange ? 'loopback-not-authorized' : result.reason,
          }),
          403,
          { 'content-type': 'application/json; charset=utf-8' },
        ));
        return true;
      }
      const next = await createLease({
        tabId: current.tabId,
        deviceId: current.deviceId,
        url: target,
        origin,
        channel: current.channel,
      });
      try {
        const bootstrapUrl = browserBootstrap.issue({
          url: next.url,
          origin: next.publicOrigin,
          deviceId: next.deviceId,
          preserveMethod: true,
          redirectStatus: 307,
        });
        await event.setMock(new hammerhead.ResponseMock(
          '',
          307,
          hammerheadRebindHeaders(bootstrapUrl),
        ));
        leases.set(current.key, next);
        touch(next);
        if (current.timer != null) clearTimer(current.timer);
        current.detachCookies();
        current.pool.proxy.closeSession(current.session);
        return true;
      } catch (error) {
        next.detachCookies();
        next.pool.proxy.closeSession(next.session);
        throw error;
      }
    });
  };

  const sessionIdForPath = (pathname) => {
    const descriptor = String(pathname || '').split('/')[1] || '';
    const sessionId = descriptor.split(/[!*]/, 1)[0];
    return sessionId.startsWith('_browser-') ? sessionId : null;
  };

  return {
    putLease: (options) => put(options),
    navigateLease(tabId, url, deviceId, origin) {
      return put({ tabId, url, deviceId, origin }, true);
    },
    getLease(tabId, deviceId) {
      return publicLease(leases.get(leaseKey(deviceId, tabId)));
    },
    deleteLease(tabId, deviceId) {
      return release(leases.get(leaseKey(deviceId, tabId)));
    },
    hasDevice(deviceId) {
      return [...leases.values()].some((lease) => lease.deviceId === deviceId);
    },
    ownsPublicPath(pathname, deviceId) {
      const sessionId = sessionIdForPath(pathname);
      return [...leases.values()].some((lease) => (
        lease.deviceId === deviceId && lease.session.id === sessionId
      ));
    },
    resolvePublicRequest(pathname, deviceId, rawOrigin) {
      let origin;
      try { origin = normalizedOrigin(rawOrigin); } catch { return null; }
      const sessionId = sessionIdForPath(pathname);
      const lease = [...leases.values()].find((item) => (
        item.deviceId === deviceId
        && item.publicOrigin === origin
        && (!sessionId || item.session.id === sessionId)
      ));
      if (!lease) return null;
      touch(lease);
      return { port: lease.pool.ports[0], origin: lease.publicOrigin };
    },
    configureDeviceProfile(deviceId, prefs) {
      return cookieProfiles.configure(deviceId, prefs);
    },
    async clearDeviceProfile(deviceId, { origin } = {}) {
      const matching = [...leases.values()].filter((lease) => {
        if (lease.deviceId !== deviceId) return false;
        return origin === null || new URL(lease.originalUrl).origin === origin;
      });
      const closedTabIds = [];
      for (const lease of matching) {
        if (release(lease)) closedTabIds.push(lease.tabId);
      }
      await cookieProfiles.clear(deviceId, {
        hostname: origin === null ? undefined : new URL(origin).hostname,
      });
      await cookieProfiles.flush?.(deviceId);
      return { closedTabIds };
    },
    async close() {
      if (closing) return;
      closing = true;
      for (const lease of [...leases.values()]) release(lease);
      await Promise.allSettled([...pendingPools.values(), ...leaseQueues.values()]);
      for (const lease of [...leases.values()]) release(lease);
      for (const pool of pools.values()) pool.proxy.close();
      pools.clear();
      await cookieProfiles.close?.();
    },
  };
}
