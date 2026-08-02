import dns from 'node:dns/promises';
import net from 'node:net';

function ipv4Parts(address) {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function ipv6Words(address) {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (half) => {
    if (!half) return [];
    const words = [];
    for (const token of half.split(':')) {
      if (token.includes('.')) {
        const parts = ipv4Parts(token);
        if (!parts) return null;
        words.push((parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
        words.push(Number.parseInt(token, 16));
      }
    }
    return words;
  };
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] || '');
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const omitted = 8 - left.length - right.length;
  if (omitted < 1) return null;
  return [...left, ...Array(omitted).fill(0), ...right];
}

function mappedIpv4Parts(address) {
  const words = ipv6Words(address);
  if (!words
    || words.slice(0, 5).some((word) => word !== 0)
    || words[5] !== 0xffff) return null;
  return [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff];
}

function classifyIpv4(parts) {
  if (parts[0] === 0) return 'unspecified';
  if (parts[0] === 127) return 'loopback';
  if (parts[0] === 169 && parts[1] === 254) return 'link-local';
  if (parts[0] >= 224) return 'multicast';
  return null;
}

export function classifyIp(raw) {
  const address = String(raw || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(address) === 4) {
    const parts = ipv4Parts(address);
    return classifyIpv4(parts);
  }
  if (net.isIP(address) === 6) {
    const mapped = mappedIpv4Parts(address);
    if (mapped) return classifyIpv4(mapped);
    if (address === '::') return 'unspecified';
    if (address === '::1') return 'loopback';
    if (/^fe[89ab]/.test(address)) return 'link-local';
    if (address.startsWith('ff')) return 'multicast';
    return null;
  }
  return null;
}

function effectivePort(url) {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}

export function createBrowserTargetPolicy({
  topLevelUrl,
  handmuxOrigin,
  lookup = dns.lookup,
} = {}) {
  let topOrigin = new URL(topLevelUrl).origin;
  let topAddressClass = null;
  const appUrl = new URL(handmuxOrigin);
  const appOrigin = appUrl.origin;
  const appControlPort = effectivePort(appUrl);

  return {
    authorizeTopLevel(raw) {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('browser URL must use http or https');
      topOrigin = url.origin;
      topAddressClass = null;
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

      const classifications = addresses.map((item) => classifyIp(item.address));
      if (effectivePort(url) === appControlPort && classifications.some((reason) => reason === 'loopback')) {
        return { allowed: false, reason: 'handmux-origin' };
      }
      if (url.origin === topOrigin && topAddressClass == null) {
        if (classifications.every((reason) => reason === 'loopback')) topAddressClass = 'loopback';
        else if (classifications.every((reason) => reason == null)) topAddressClass = 'ordinary';
      }
      const loopbackNavigationAllowed = url.origin === topOrigin
        && topAddressClass === 'loopback'
        && classifications.every((reason) => reason === 'loopback');
      for (const reason of classifications) {
        if (reason === 'loopback' && loopbackNavigationAllowed) continue;
        if (reason) return { allowed: false, reason: reason === 'loopback' ? 'loopback-not-authorized' : reason };
      }
      return {
        allowed: true,
        addresses: addresses.map((item) => ({
          address: item.address,
          family: item.family || net.isIP(item.address),
        })),
      };
    },
  };
}
