// Detect LOOPBACK dev-server URLs printed in the terminal (`http://localhost:3000/foo/bar`) so they
// become tappable → "开启代理并预览" (register a dynamic-preview reverse-proxy to that local port and
// open it in the preview sheet, path suffix preserved). Only loopback hosts qualify — a LAN IP might be
// directly reachable from the phone, so proxying it would be redundant/misleading; a loopback address
// on the host is unreachable from the phone and is exactly what the proxy is for.
import { DELIMS } from './docPath.js';

// localhost | 127.0.0.1 | 0.0.0.0 | [::1] — the four ways a dev server advertises its loopback bind.
const HOST = '(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\])';
// http(s)://<loopback>(:port)?(/path...)? — the path runs to the same delimiter set doc-paths use, so a
// URL sitting in Chinese prose / brackets ends where the eye says it does. Port + path are optional.
const LOCAL_URL_RE = new RegExp(`https?://${HOST}(?::(\\d{1,5}))?(/[^${DELIMS}]*)?`, 'gi');

// Find every loopback URL in one line of text → [{ start, end, protocol, port, path, raw }] (end exclusive).
//   - port: the URL's port, or the scheme default (80/443) when omitted — so a bare `http://localhost/`
//     still yields a number (its proxy will just fail the port-listening probe, which is the honest result).
//   - path: the `/…` suffix (query/hash included, to the delimiter), or '/' when absent — this is what the
//     proxy opens, so the tapped deep link lands on the same page as on the PC.
//   - raw: the exact matched substring (trailing prose dots stripped), for the confirm popover's label.
export function findLocalUrls(line) {
  const out = [];
  if (!line) return out;
  LOCAL_URL_RE.lastIndex = 0;
  let m;
  while ((m = LOCAL_URL_RE.exec(line)) !== null) {
    const isHttps = /^https:/i.test(m[0]);
    const port = m[1] ? Number(m[1]) : (isHttps ? 443 : 80);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    // A trailing '.' clings from prose ("…visit http://localhost:3000/foo.") — it's a sentence stop, not
    // part of the path. Strip trailing dots (only the path group can end in one) and shrink the end offset.
    const rawPath = m[2] || '';
    const path = rawPath.replace(/\.+$/, '');
    const end = m.index + m[0].length - (rawPath.length - path.length);
    out.push({ start: m.index, end, protocol: isHttps ? 'https' : 'http', port, path: path || '/', raw: line.slice(m.index, end) });
  }
  return out;
}
