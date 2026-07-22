// server/src/previews.js
// Preview registry. Maps a safe single-segment name to an on-disk directory under $HOME with a TTL.
// in-memory registry (loaded once at construction, flushed atomically on each mutation) — the previous
// reload-and-write-back on every op was an unguarded read-modify-write that could lose an entry when a
// GET's expiry-prune raced a concurrent register(). Pure-ish: home/now/store/ttl are injected for tests.
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
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
  ttlMs = Number(process.env.HANDMUX_PREVIEW_TTL) || 3_600_000,
} = {}) {
  let realHome;
  try { realHome = fs.realpathSync(home); } catch { realHome = home; }

  // Loaded ONCE — this in-memory array is the source of truth; every op mutates it and flushes atomically.
  let entries = readJsonArray(store);
  const flush = () => writeJsonAtomic(store, entries);

  // Drop any prior entry with this name, stamp one timestamp into createdAt/expiresAt, then persist.
  const upsert = (fields) => {
    entries = entries.filter((e) => e && e.name !== fields.name);
    const ts = now();
    const entry = { ...fields, createdAt: ts, expiresAt: ts + ttlMs };
    entries.push(entry);
    flush();
    return { name: entry.name, kind: entry.kind, expiresAt: entry.expiresAt };
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
    if (entry.expiresAt <= now()) { entries = entries.filter((e) => e.name !== name); flush(); return { state: 'expired' }; }
    if (entry.kind === 'dynamic') { entries = entries.filter((e) => e.name !== name); flush(); return { state: 'missing' }; }
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
