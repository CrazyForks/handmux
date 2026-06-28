// server/src/previews.js
// Preview registry. Maps a safe single-segment name → either an on-disk directory under $HOME
// (kind:'static') or a local port (kind:'dynamic'), with a TTL. Persistence mirrors push.js: a JSON
// array at server/data/previews.json, read fresh on each op. Pure-ish: home/now/store/ttl plus the
// dynamic switch and port probe are injected so it unit-tests on its own.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isUnder } from './docPath.js';

export function safePreviewName(raw) {
  if (typeof raw !== 'string') return null;
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) return null;
  if (raw === '.' || raw === '..' || raw[0] === '.') return null;
  // Normalize to lowercase: a dynamic preview is reached via a subdomain, and browsers lowercase the
  // hostname — so a stored name with uppercase (from a tmux window name) could never be matched. Keep
  // register/get/subdomain all on the same lowercased key.
  return raw.toLowerCase();
}

// Is something listening on a loopback `host:port`? A quick TCP connect with a short timeout.
function probeHost(port, host, timeout) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const finish = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => finish(false));
    s.once('connect', () => finish(true));
    s.once('error', () => finish(false));
  });
}

// Which loopback host answers on `port` — '127.0.0.1', '::1', or null if neither. macOS dev servers
// often bind ONLY IPv6 localhost (::1), so a 127.0.0.1-only probe wrongly reports "not listening".
// The answering host is stored on the entry so the proxy connects to the same family the app is on.
async function probeListening(port, timeout = 300) {
  if (await probeHost(port, '127.0.0.1', timeout)) return '127.0.0.1';
  if (await probeHost(port, '::1', timeout)) return '::1';
  return null;
}

export function createPreviews({
  home = homedir(),
  store = process.env.PREVIEW_STORE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/previews.json'),
  now = () => Date.now(),
  ttlMs = Number(process.env.HANDMUX_PREVIEW_TTL) || 3_600_000,
  dynamicEnabled = false,
  probePort = probeListening,
} = {}) {
  let realHome;
  try { realHome = fs.realpathSync(home); } catch { realHome = home; }

  const loadStore = () => {
    try { return JSON.parse(fs.readFileSync(store, 'utf8')) || []; } catch { return []; }
  };
  const saveStore = (arr) => {
    try { fs.mkdirSync(path.dirname(store), { recursive: true }); fs.writeFileSync(store, JSON.stringify(arr)); }
    catch { /* best effort: a lost registry just means previews must be re-started */ }
  };

  // Common upsert: drop any prior entry with this name (so static↔dynamic switching just replaces),
  // stamp a single now() into createdAt/expiresAt, persist.
  const upsert = (fields) => {
    const all = loadStore().filter((e) => e && e.name !== fields.name);
    const ts = now();
    const entry = { ...fields, createdAt: ts, expiresAt: ts + ttlMs };
    all.push(entry);
    saveStore(all);
    return { name: entry.name, kind: entry.kind, expiresAt: entry.expiresAt };
  };

  async function register({ name, dir, port }) {
    const nm = safePreviewName(name);
    if (!nm) return { error: 'bad name', status: 400 };
    if (port !== undefined && port !== null && port !== '') {
      if (!dynamicEnabled) return { error: 'dynamic disabled', status: 400 };
      const p = Number(port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) return { error: 'bad port', status: 400 };
      const host = await probePort(p); // '127.0.0.1' | '::1' | null
      if (!host) return { error: 'port not listening', status: 400 };
      return upsert({ name: nm, kind: 'dynamic', port: p, host });
    }
    if (typeof dir !== 'string' || dir[0] !== '/') return { error: 'not absolute', status: 400 };
    let real;
    try { real = fs.realpathSync(dir); } catch { return { error: 'not found', status: 404 }; }
    if (!isUnder(real, realHome)) return { error: 'outside home', status: 400 };
    let st;
    try { st = fs.statSync(real); } catch { return { error: 'not accessible', status: 404 }; }
    if (!st.isDirectory()) return { error: 'not a directory', status: 400 };
    return upsert({ name: nm, kind: 'static', dir: real });
  }

  function get(name) {
    const all = loadStore();
    const entry = all.find((e) => e && e.name === name);
    if (!entry) return { state: 'missing' };
    if (entry.expiresAt <= now()) { saveStore(all.filter((e) => e.name !== name)); return { state: 'expired' }; }
    return { state: 'active', entry: { kind: 'static', ...entry } }; // legacy rows (no kind) → static
  }

  function list() {
    const all = loadStore();
    const active = all.filter((e) => e && e.expiresAt > now());
    if (active.length !== all.length) saveStore(active);
    return active.map((e) => (e.kind === 'dynamic'
      ? { name: e.name, kind: 'dynamic', port: e.port, expiresAt: e.expiresAt }
      : { name: e.name, kind: 'static', dir: e.dir, expiresAt: e.expiresAt }));
  }

  function remove(name) {
    const all = loadStore();
    const next = all.filter((e) => e && e.name !== name);
    if (next.length !== all.length) saveStore(next);
  }

  return { register, get, list, remove };
}
