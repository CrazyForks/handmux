// server/src/previews.js
// Preview registry. Maps a safe single-segment name → either an on-disk directory under $HOME
// (kind:'static') or a local port (kind:'dynamic'), with a TTL. Like push.js it's a single-writer
// in-memory registry (loaded once at construction, flushed atomically on each mutation) — the previous
// reload-and-write-back on every op was an unguarded read-modify-write that could lose an entry when a
// GET's expiry-prune raced a concurrent register(). Pure-ish: home/now/store/ttl plus the dynamic switch
// and port probe are injected so it unit-tests on its own.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isUnder } from './docPath.js';
import { readJsonArray, writeJsonAtomic } from './jsonStore.js';

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

  // Loaded ONCE — this in-memory array is the source of truth; every op mutates it and flushes atomically.
  let entries = readJsonArray(store);
  const flush = () => writeJsonAtomic(store, entries);

  // Common upsert: drop any prior entry with this name (so static↔dynamic switching just replaces),
  // stamp a single now() into createdAt/expiresAt, persist.
  const upsert = (fields) => {
    entries = entries.filter((e) => e && e.name !== fields.name);
    const ts = now();
    const entry = { ...fields, createdAt: ts, expiresAt: ts + ttlMs };
    entries.push(entry);
    flush();
    return { name: entry.name, kind: entry.kind, expiresAt: entry.expiresAt };
  };

  async function register({ name, dir, port, protocol = 'http' }) {
    const nm = safePreviewName(name);
    if (!nm) return { error: 'bad name', status: 400 };
    if (port !== undefined && port !== null && port !== '') {
      if (!dynamicEnabled) return { error: 'dynamic disabled', status: 400 };
      if (protocol !== 'http' && protocol !== 'https') return { error: 'bad protocol', status: 400 };
      const p = Number(port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) return { error: 'bad port', status: 400 };
      const host = await probePort(p); // '127.0.0.1' | '::1' | null
      if (!host) return { error: 'port not listening', status: 400 };
      return upsert({ name: nm, kind: 'dynamic', port: p, host, protocol });
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
    const entry = entries.find((e) => e && e.name === name);
    if (!entry) return { state: 'missing' };
    if (entry.expiresAt <= now()) { entries = entries.filter((e) => e.name !== name); flush(); return { state: 'expired' }; }
    const normalized = entry.kind === 'dynamic'
      ? { ...entry, kind: 'dynamic', protocol: entry.protocol === 'https' ? 'https' : 'http' }
      : { kind: 'static', ...entry }; // legacy rows (no kind) → static
    return { state: 'active', entry: normalized };
  }

  function list() {
    const active = entries.filter((e) => e && e.expiresAt > now());
    if (active.length !== entries.length) { entries = active; flush(); }
    return active.map((e) => (e.kind === 'dynamic'
      ? { name: e.name, kind: 'dynamic', port: e.port, protocol: e.protocol === 'https' ? 'https' : 'http', expiresAt: e.expiresAt }
      : { name: e.name, kind: 'static', dir: e.dir, expiresAt: e.expiresAt }));
  }

  function remove(name) {
    const next = entries.filter((e) => e && e.name !== name);
    if (next.length !== entries.length) { entries = next; flush(); }
  }

  return { register, get, list, remove };
}
