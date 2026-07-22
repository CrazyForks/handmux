import dns from 'node:dns/promises';
import net from 'node:net';

function ipv4Parts(address) {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function classifyIp(raw) {
  const address = String(raw || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(address) === 4) {
    const parts = ipv4Parts(address);
    if (parts[0] === 0) return 'unspecified';
    if (parts[0] === 127) return 'loopback';
    if (parts[0] === 169 && parts[1] === 254) return 'link-local';
    if (parts[0] >= 224) return 'multicast';
    return null;
  }
  if (net.isIP(address) === 6) {
    if (address === '::') return 'unspecified';
    if (address === '::1') return 'loopback';
    if (/^fe[89ab]/.test(address)) return 'link-local';
    if (address.startsWith('ff')) return 'multicast';
    const mapped = address.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return classifyIp(mapped);
    return null;
  }
  return null;
}

export function createBrowserTargetPolicy({
  topLevelUrl,
  handmuxOrigin,
  lookup = dns.lookup,
} = {}) {
  let topOrigin = new URL(topLevelUrl).origin;
  const appOrigin = new URL(handmuxOrigin).origin;

  return {
    authorizeTopLevel(raw) {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('browser URL must use http or https');
      topOrigin = url.origin;
    },

    async check(raw) {
      let url;
      try { url = new URL(raw); } catch { return { allowed: false, reason: 'unsupported-protocol' }; }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { allowed: false, reason: 'unsupported-protocol' };
      }
      if (url.origin === appOrigin) return { allowed: false, reason: 'handmux-origin' };

      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      let addresses;
      if (net.isIP(hostname)) addresses = [{ address: hostname }];
      else {
        try { addresses = await lookup(hostname, { all: true, verbatim: true }); }
        catch { return { allowed: false, reason: 'dns-failed' }; }
      }
      if (!addresses?.length) return { allowed: false, reason: 'dns-failed' };

      for (const item of addresses) {
        const reason = classifyIp(item.address);
        if (reason === 'loopback' && url.origin === topOrigin) continue;
        if (reason) return { allowed: false, reason: reason === 'loopback' ? 'loopback-not-authorized' : reason };
      }
      return { allowed: true };
    },
  };
}
