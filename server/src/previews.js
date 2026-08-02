// server/src/previews.js
// Preview registry. Maps a safe single-segment name to an on-disk directory under $HOME with a lease.
// in-memory registry (loaded once at construction, flushed atomically on each mutation) — the previous
// reload-and-write-back on every op was an unguarded read-modify-write that could lose an entry when a
// GET's lease update raced a concurrent register(). Pure-ish: home/now/store/ttl are injected for tests.
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isUnder } from './docPath.js';
import { readJsonArray, writeJsonAtomic } from './jsonStore.js';

export function safePreviewName(raw) {
  if (typeof raw !== 'string') return null;
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) return null;
  if (raw === '.' || raw === '..' || raw[0] === '.') return null;
  // Keep lookups stable across clients that may normalize user-provided names differently.
  return raw.toLowerCase();
}

export function createPreviews({
  home = homedir(),
  store = process.env.PREVIEW_STORE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/previews.json'),
  now = () => Date.now(),
  ttlMs = 2 * 60 * 60_000,
  randomToken = () => randomBytes(24).toString('base64url'),
} = {}) {
  let realHome;
  try { realHome = fs.realpathSync(home); } catch { realHome = home; }

  // Loaded ONCE — this in-memory array is the source of truth; every op mutates it and flushes atomically.
  let entries = readJsonArray(store);
  let flushedExpiries = new Map(entries.map((entry) => [entry?.name, entry?.expiresAt]));
  const flush = () => {
    // Access tokens are runtime capabilities. Open device tabs re-register after a restart and receive
    // a fresh token, so a stale registry file can never resurrect an old preview URL.
    writeJsonAtomic(store, entries.map(({ accessToken: _accessToken, ...entry }) => entry));
    flushedExpiries = new Map(entries.map((entry) => [entry?.name, entry?.expiresAt]));
  };

  const resultFor = (entry) => ({
    name: entry.name,
    kind: entry.kind,
    accessToken: entry.accessToken,
    expiresAt: entry.expiresAt,
  });

  // Re-registering the same active directory is a lease renewal. Preserve its capability so a
  // foreground check does not change the iframe URL and reload an already-mounted page. A changed
  // directory, expired row, or process-restored row without a runtime token receives a fresh one.
  const upsert = (fields) => {
    const ts = now();
    const current = entries.find((entry) => entry && entry.name === fields.name);
    if (current?.kind === fields.kind
      && current.dir === fields.dir
      && current.expiresAt > ts
      && typeof current.accessToken === 'string'
      && current.accessToken) {
      current.expiresAt = ts + ttlMs;
      flush();
      return resultFor(current);
    }
    entries = entries.filter((e) => e && e.name !== fields.name);
    const entry = {
      ...fields,
      accessToken: randomToken(),
      createdAt: ts,
      expiresAt: ts + ttlMs,
    };
    entries.push(entry);
    flush();
    return resultFor(entry);
  };

  async function register({ name, dir, port }) {
    const nm = safePreviewName(name);
    if (!nm) return { error: 'bad name', status: 400 };
    if (port !== undefined && port !== null && port !== '') return { error: 'bad request', status: 400 };
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
    const ts = now();
    if (entry.expiresAt <= ts) { entries = entries.filter((e) => e.name !== name); flush(); return { state: 'expired' }; }
    if (entry.kind === 'dynamic') { entries = entries.filter((e) => e.name !== name); flush(); return { state: 'missing' }; }
    // Match proxy leases: actual page/resource traffic renews the lease. Throttle persistence so a page
    // with many assets does not rewrite the registry once per request.
    const nextExpiry = ts + ttlMs;
    entry.expiresAt = nextExpiry;
    if (nextExpiry - (flushedExpiries.get(entry.name) || 0) >= 60_000) flush();
    return { state: 'active', entry: { kind: 'static', ...entry } }; // legacy rows (no kind) → static
  }

  function list() {
    const active = entries.filter((e) => e && e.kind !== 'dynamic' && e.expiresAt > now());
    if (active.length !== entries.length) { entries = active; flush(); }
    return active.map((e) => ({ name: e.name, kind: 'static', dir: e.dir, expiresAt: e.expiresAt }));
  }

  function remove(name) {
    const next = entries.filter((e) => e && e.name !== name);
    if (next.length !== entries.length) { entries = next; flush(); }
  }

  return { register, get, list, remove };
}
