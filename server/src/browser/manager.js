import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import * as importedHammerhead from 'testcafe-hammerhead';
import { createDeviceCookieProfiles } from './cookieProfiles.js';
import { createBrowserProfilePersistence } from './profilePersistence.js';
import { claimPublicOrigin } from './originLabel.js';
import { createBrowserSessionStore } from './sessionStore.js';
import { createBrowserTargetPolicy } from './targetPolicy.js';

const defaultHammerhead = importedHammerhead.default || importedHammerhead;

function publicTab(tab) {
  if (!tab) return null;
  const {
    session: _session,
    ownerDevice: _ownerDevice,
    pool: _pool,
    publicOrigin: _publicOrigin,
    contextKey: _contextKey,
    ...out
  } = tab;
  return out;
}

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
    if (hammerhead?.EVENTS?.pageNavigationTriggered) {
      hammerhead.on(hammerhead.EVENTS.pageNavigationTriggered, (url) => send('navigate', url));
    }
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
        windowId: '',
        requestTimeout: { page: 30_000, ajax: 30_000 },
        nativeAutomation: false,
      });
      this.channel = channel;
    }

    async getPayloadScript(windowId) { return bridgeScript(windowId || this.channel); }
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
      server.removeListener?.('listening', onListening);
      server.removeListener?.('error', onError);
      server.removeListener?.('close', onClose);
    };
    const onListening = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error('browser manager closing')); };
    server.once('listening', onListening);
    server.once('error', onError);
    server.once('close', onClose);
  });
}

export async function createBrowserPreviewManager({
  hammerhead = defaultHammerhead,
  internalPorts = [0, 0],
  randomId = () => randomBytes(18).toString('base64url'),
  randomChannel = () => randomBytes(18).toString('base64url'),
  targetPolicyFactory = createBrowserTargetPolicy,
  cookieProfiles: suppliedCookieProfiles,
  profilePersistence: suppliedProfilePersistence,
  profileDir = path.join(os.homedir(), '.handmux', 'browser-profiles'),
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const ProxyClass = hammerhead.Proxy;
  const SessionClass = browserSessionClass(hammerhead);
  const profilePersistence = suppliedProfilePersistence || createBrowserProfilePersistence({
    dir: profileDir,
    keyFile: path.join(profileDir, 'profile.key'),
  });
  const cookieProfiles = suppliedCookieProfiles || createDeviceCookieProfiles({
    createCookies: () => new SessionClass('').cookies,
    persistence: profilePersistence,
    now, setTimer, clearTimer,
  });
  const pools = new Map();
  const pendingPools = new Map();
  const contexts = new Map();
  const pendingContexts = new Map();
  const publicOriginClaims = new Map();
  let poolCount = 0;
  let closing = false;
  let closePromise = null;
  const policies = new WeakMap();
  const closedProxies = new WeakSet();

  const closeProxy = (proxy) => {
    if (!proxy || closedProxies.has(proxy)) return;
    closedProxies.add(proxy);
    proxy.close();
  };

  const createPool = (origin) => {
    const proxy = new ProxyClass();
    const requestedPorts = poolCount++ === 0 ? internalPorts : [0, 0];
    let promise;
    try {
      proxy.start({
        hostname: '127.0.0.1',
        port1: requestedPorts[0],
        port2: requestedPorts[1],
        disableCrossDomain: true,
        disableHttp2: true,
      });
      promise = (async () => {
        try {
          await Promise.all([waitForListening(proxy.server1), waitForListening(proxy.server2)]);
          if (closing) throw new Error('browser manager closing');
          const ports = [
            proxy.server1?.address?.()?.port ?? requestedPorts[0],
            proxy.server2?.address?.()?.port ?? requestedPorts[1],
          ];
          applyPublicOrigin(proxy, origin);
          const pool = { origin, proxy, ports };
          pools.set(origin, pool);
          return pool;
        } catch (error) {
          closeProxy(proxy);
          throw error;
        } finally {
          if (pendingPools.get(origin)?.promise === promise) pendingPools.delete(origin);
        }
      })();
    } catch (error) {
      closeProxy(proxy);
      throw error;
    }
    const pending = { proxy, promise };
    pendingPools.set(origin, pending);
    return pending;
  };
  const poolFor = async (origin) => {
    if (closing) throw new Error('browser manager closing');
    if (pools.has(origin)) return pools.get(origin);
    if (!pendingPools.has(origin)) createPool(origin);
    return pendingPools.get(origin).promise;
  };

  const contextKeyFor = (deviceId, targetOrigin) => `${deviceId}\u0000${targetOrigin}`;
  const contextFor = async ({ deviceId, target, origin, sessionId }) => {
    const targetOrigin = new URL(target).origin;
    claimPublicOrigin(publicOriginClaims, origin, targetOrigin);
    const key = contextKeyFor(deviceId, targetOrigin);
    const existing = contexts.get(key);
    if (existing) {
      if (existing.publicOrigin !== origin) throw new Error('browser target origin already uses a different public origin');
      return existing;
    }
    if (pendingContexts.has(key)) {
      const pending = await pendingContexts.get(key);
      if (pending.publicOrigin !== origin) throw new Error('browser target origin already uses a different public origin');
      return pending;
    }
    const promise = (async () => {
      const pool = await poolFor(origin);
      if (closing) throw new Error('browser manager closing');
      const session = new SessionClass('');
      session.id = `_browser-${sessionId()}`;
      const policy = targetPolicyFactory({ topLevelUrl: target, handmuxOrigin: origin });
      policies.set(session, policy);
      const requestHooks = session.requestHookEventProvider || session;
      requestHooks.addRequestEventListeners(hammerhead.RequestFilterRule.ANY, {
        onRequest: async (event) => {
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
      const context = {
        key, targetOrigin, publicOrigin: origin, pool, session, policy, detachCookies, tabIds: new Set(),
      };
      contexts.set(key, context);
      return context;
    })().finally(() => pendingContexts.delete(key));
    pendingContexts.set(key, promise);
    return promise;
  };
  const releaseContext = (context) => {
    if (!context || contexts.get(context.key) !== context) return;
    contexts.delete(context.key);
    context.detachCookies();
    context.pool.proxy.closeSession(context.session);
  };
  const releaseTabContext = (tab) => {
    const context = tab && contexts.get(tab.contextKey);
    if (!context) return;
    context.tabIds.delete(tab.id);
    if (context.tabIds.size) return;
    releaseContext(context);
  };
  const releaseEmptyContext = (context) => {
    if (!context || context.tabIds.size || contexts.get(context.key) !== context) return;
    releaseContext(context);
  };
  const openTabSession = (context, target, channel) => {
    const previousWindowId = context.session.options.windowId;
    context.session.options.windowId = channel;
    try { return context.pool.proxy.openSession(target, context.session); }
    finally { context.session.options.windowId = previousWindowId; }
  };
  let store;
  const updateDeviceActivity = (deviceId) => cookieProfiles.setActive?.(
    deviceId,
    store.list().some((tab) => tab.ownerDevice === deviceId && tab.mode === 'proxy'),
  );
  store = createBrowserSessionStore({
    now, setTimer, clearTimer,
    onExpire: (tab) => { releaseTabContext(tab); updateDeviceActivity(tab.ownerDevice); },
  });
  const hideOtherTabs = (deviceId, exceptId, closeAfterMinutes) => {
    const displaced = [];
    for (const tab of store.list()) {
      if (tab.ownerDevice === deviceId && tab.id !== exceptId && tab.visible) {
        displaced.push({ id: tab.id, closeAfterMinutes: tab.closeAfterMinutes });
        store.setVisible(tab.id, false, closeAfterMinutes);
      }
    }
    return displaced;
  };

  const sessionIdForPath = (pathname) => {
    const descriptor = String(pathname || '').split('/')[1] || '';
    const sessionId = descriptor.split(/[!*]/, 1)[0];
    return sessionId.startsWith('_browser-') ? sessionId : null;
  };
  const tabForPath = (pathname, deviceId, origin) => {
    const sessionId = sessionIdForPath(pathname);
    if (!sessionId) return null;
    return store.list().find((tab) => tab.session?.id === sessionId
      && tab.ownerDevice === deviceId && (!origin || tab.publicOrigin === origin)) || null;
  };

  const manager = {
    ownsPublicPath(pathname, deviceId) {
      return !!tabForPath(pathname, deviceId);
    },

    hasDevice(deviceId) {
      return !!deviceId && store.list().some((tab) => tab.ownerDevice === deviceId);
    },

    serializeDeviceProfile(deviceId) {
      return cookieProfiles.serialize(deviceId);
    },

    clearDeviceProfile(deviceId, options) {
      return cookieProfiles.clear(deviceId, options);
    },

    configureDeviceProfile(deviceId, prefs) {
      return cookieProfiles.configure(deviceId, prefs);
    },

    resolvePublicRequest(pathname, deviceId, rawOrigin) {
      let origin;
      try { origin = normalizedOrigin(rawOrigin); } catch { return null; }
      const sessionId = sessionIdForPath(pathname);
      const sameOriginTabs = store.list().filter((item) => item.mode === 'proxy'
        && item.ownerDevice === deviceId && item.publicOrigin === origin);
      const tab = sessionId
        ? tabForPath(pathname, deviceId, origin)
        : sameOriginTabs.find((item) => item.visible) || sameOriginTabs[0];
      return tab ? { port: tab.pool.ports[0], origin: tab.publicOrigin } : null;
    },

    async create({ url, origin, closeAfterMinutes, deviceId, mode: rawMode }) {
      if (!deviceId) throw new Error('browser device id required');
      if (closing) throw new Error('browser manager closing');
      const target = normalizedTarget(url);
      const requestedOrigin = normalizedOrigin(origin);
      const mode = rawMode === 'direct' ? 'direct' : 'proxy';
      const id = randomId();
      const channel = randomChannel();
      let context = null;
      let publicUrl = target;
      if (mode === 'proxy') {
        context = await contextFor({ deviceId, target, origin: requestedOrigin, sessionId: () => id });
        if (closing) {
          releaseEmptyContext(context);
          throw new Error('browser manager closing');
        }
        context.policy.authorizeTopLevel?.(target);
        try { publicUrl = openTabSession(context, target, channel); }
        catch (error) {
          releaseEmptyContext(context);
          throw error;
        }
      }
      const displacedTabs = hideOtherTabs(deviceId, id, closeAfterMinutes);
      context?.tabIds.add(id);
      const created = publicTab(store.add({
        id, mode, session: context?.session || null, channel, url: publicUrl, originalUrl: target, title: '', closeAfterMinutes,
        ownerDevice: deviceId, publicOrigin: requestedOrigin, pool: context?.pool || null, contextKey: context?.key || null,
      }));
      Object.defineProperty(created, '_displacedTabs', { value: displacedTabs });
      if (mode === 'proxy') cookieProfiles.setActive?.(deviceId, true);
      return created;
    },

    get(id, deviceId) {
      const tab = store.get(id);
      return tab?.ownerDevice === deviceId ? publicTab(tab) : null;
    },
    list(deviceId) { return store.list().filter((tab) => tab.ownerDevice === deviceId).map(publicTab); },

    setVisible(id, visible, closeAfterMinutes, deviceId) {
      if (!manager.get(id, deviceId)) return null;
      if (visible) hideOtherTabs(deviceId, id, closeAfterMinutes);
      return publicTab(store.setVisible(id, visible, closeAfterMinutes));
    },

    async navigate(id, url, deviceId, origin, rawMode) {
      const initialTab = store.get(id);
      if (!initialTab || initialTab.ownerDevice !== deviceId) return null;
      const target = normalizedTarget(url);
      const requestedOrigin = normalizedOrigin(origin || initialTab.publicOrigin);
      const mode = rawMode === 'direct' ? 'direct' : 'proxy';
      if (mode === 'direct') {
        const tab = store.get(id);
        if (!tab || tab.ownerDevice !== deviceId) return null;
        const updated = store.update(id, {
          mode,
          url: target,
          originalUrl: target,
          session: null,
          publicOrigin: requestedOrigin,
          pool: null,
          contextKey: null,
        });
        releaseTabContext(tab);
        updateDeviceActivity(deviceId);
        return publicTab(updated);
      }
      const context = await contextFor({ deviceId, target, origin: requestedOrigin, sessionId: randomId });
      const tab = store.get(id);
      if (!tab || tab.ownerDevice !== deviceId) {
        releaseEmptyContext(context);
        return null;
      }
      context.policy.authorizeTopLevel?.(target);
      let publicUrl;
      try { publicUrl = openTabSession(context, target, tab.channel); }
      catch (error) {
        releaseEmptyContext(context);
        throw error;
      }
      if (context.key !== tab.contextKey) {
        context.tabIds.add(id);
      }
      const updated = store.update(id, {
        mode,
        url: publicUrl,
        originalUrl: target,
        session: context.session,
        publicOrigin: context.publicOrigin,
        pool: context.pool,
        contextKey: context.key,
      });
      if (context.key !== tab.contextKey) releaseTabContext(tab);
      cookieProfiles.setActive?.(deviceId, true);
      return publicTab(updated);
    },

    closeTab(id, deviceId) {
      if (!manager.get(id, deviceId)) return null;
      const tab = store.remove(id);
      releaseTabContext(tab);
      updateDeviceActivity(deviceId);
      return publicTab(tab);
    },

    close() {
      if (!closePromise) {
        closing = true;
        closePromise = (async () => {
          const closingTabs = store.close();
          const devices = new Set(closingTabs.map((tab) => tab.ownerDevice));
          for (const tab of closingTabs) releaseTabContext(tab);
          for (const deviceId of devices) updateDeviceActivity(deviceId);
          for (const context of [...contexts.values()]) releaseContext(context);
          contexts.clear();
          const pending = [...pendingPools.values()];
          for (const entry of pending) closeProxy(entry.proxy);
          await Promise.allSettled(pending.map((entry) => entry.promise));
          for (const pool of pools.values()) closeProxy(pool.proxy);
          pools.clear();
          await cookieProfiles.close?.();
        })();
      }
      return closePromise;
    },
  };
  return manager;
}
