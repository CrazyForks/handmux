import { randomBytes } from 'node:crypto';
import * as importedHammerhead from 'testcafe-hammerhead';
import { createBrowserSessionStore } from './sessionStore.js';
import { createBrowserTargetPolicy } from './targetPolicy.js';

const defaultHammerhead = importedHammerhead.default || importedHammerhead;

function publicTab(tab) {
  if (!tab) return null;
  const { session: _session, ...out } = tab;
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
    const send = (type) => parent.postMessage({ source: 'handmux-browser', channel, type, url: location.href, title: document.title }, '*');
    let pending = false;
    const activity = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; send('activity'); }, 250);
    };
    for (const name of ['pointerdown', 'keydown', 'input', 'scroll']) addEventListener(name, activity, { capture: true, passive: true });
    addEventListener('load', () => send('load'));
    addEventListener('popstate', () => send('navigate'));
    addEventListener('hashchange', () => send('navigate'));
    new MutationObserver(() => send('title')).observe(document.querySelector('title') || document.documentElement, { subtree: true, childList: true, characterData: true });
    addEventListener('message', (event) => {
      if (event.source !== parent || event.data?.source !== 'handmux-browser-parent' || event.data?.channel !== channel) return;
      if (event.data.command === 'back') history.back();
      else if (event.data.command === 'forward') history.forward();
      else if (event.data.command === 'reload') location.reload();
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
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

export async function createBrowserPreviewManager({
  hammerhead = defaultHammerhead,
  internalPorts = [0, 0],
  randomId = () => randomBytes(18).toString('base64url'),
  randomChannel = () => randomBytes(18).toString('base64url'),
  targetPolicyFactory = createBrowserTargetPolicy,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const ProxyClass = hammerhead.Proxy;
  const SessionClass = browserSessionClass(hammerhead);
  const proxy = new ProxyClass();
  proxy.start({
    hostname: '127.0.0.1',
    port1: internalPorts[0],
    port2: internalPorts[1],
    disableCrossDomain: true,
    disableHttp2: true,
  });
  await Promise.all([waitForListening(proxy.server1), waitForListening(proxy.server2)]);
  const boundPorts = [
    proxy.server1?.address?.()?.port ?? internalPorts[0],
    proxy.server2?.address?.()?.port ?? internalPorts[1],
  ];
  let publicOrigin = null;
  const policies = new WeakMap();

  const closeHammerheadSession = (tab) => {
    if (tab?.session) proxy.closeSession(tab.session);
  };
  const store = createBrowserSessionStore({ now, setTimer, clearTimer, onExpire: closeHammerheadSession });

  const manager = {
    internalPorts: boundPorts,

    ownsPublicPath(pathname) {
      const descriptor = String(pathname || '').split('/')[1] || '';
      const sessionId = descriptor.split(/[!*]/, 1)[0];
      return sessionId.startsWith('_browser-')
        && store.list().some((tab) => tab.session?.id === sessionId);
    },

    create({ url, origin, closeAfterMinutes }) {
      const target = normalizedTarget(url);
      const requestedOrigin = normalizedOrigin(origin);
      if (publicOrigin && publicOrigin !== requestedOrigin && store.list().length) {
        throw new Error('browser sessions already use a different Handmux origin');
      }
      if (publicOrigin !== requestedOrigin) {
        publicOrigin = requestedOrigin;
        applyPublicOrigin(proxy, publicOrigin);
      }
      const id = randomId();
      const channel = randomChannel();
      const session = new SessionClass(channel);
      session.id = `_browser-${id}`;
      const policy = targetPolicyFactory({ topLevelUrl: target, handmuxOrigin: publicOrigin });
      policies.set(session, policy);
      // 31.7.8's declarations expose addRequestEventListeners on Session, while the compiled runtime
      // delegates through requestHookEventProvider. Keep the version-specific seam in this one adapter.
      const requestHooks = session.requestHookEventProvider || session;
      requestHooks.addRequestEventListeners(hammerhead.RequestFilterRule.ANY, {
        onRequest: async (event) => {
          const result = await policy.check(event._requestInfo.url);
          if (result.allowed) return;
          await event.setMock(new hammerhead.ResponseMock(
            JSON.stringify({ error: 'browser target blocked', reason: result.reason }),
            403,
            { 'content-type': 'application/json; charset=utf-8' },
          ));
        },
      }, () => {});
      const publicUrl = proxy.openSession(target, session);
      return publicTab(store.add({
        id, session, channel, url: publicUrl, originalUrl: target, title: '', closeAfterMinutes,
      }));
    },

    get(id) { return publicTab(store.get(id)); },
    list() { return store.list().map(publicTab); },

    setVisible(id, visible, closeAfterMinutes) {
      return publicTab(store.setVisible(id, visible, closeAfterMinutes));
    },

    navigate(id, url) {
      const tab = store.get(id);
      if (!tab) return null;
      const target = normalizedTarget(url);
      policies.get(tab.session)?.authorizeTopLevel?.(target);
      const publicUrl = proxy.openSession(target, tab.session);
      return publicTab(store.update(id, { url: publicUrl, originalUrl: target }));
    },

    closeTab(id) {
      const tab = store.remove(id);
      closeHammerheadSession(tab);
      return publicTab(tab);
    },

    close() {
      for (const tab of store.close()) closeHammerheadSession(tab);
      proxy.close();
    },
  };
  return manager;
}
