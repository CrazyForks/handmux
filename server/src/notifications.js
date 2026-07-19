// Per-device manual-push inbox: each subscribed device gets its own file `<NOTIF_DIR>/<pushKey>.json`, so a
// `--device`/`--session`-scoped push only lands in the targeted devices' inboxes (delete/read are naturally
// per-device too). NOTIF_DIR is injected by the CLI (~/.handmux/notifications) — NEVER the package-internal
// default, which a global reinstall wipes. Low-frequency, so each op is a plain read-modify-write of one
// device file (no in-memory state). The same push shares one record id across its target devices so a
// notification tap's inboxId resolves on whichever device opens it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { readJsonArray, writeJsonAtomic } from './jsonStore.js';
import { sanitizeNotificationUrl } from './urlPolicy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.NOTIF_DIR || path.resolve(here, '../data/notifications');
const CAP = 100;
const genId = () => crypto.randomBytes(9).toString('base64url');

// pushKey is base64url already; sanitize anyway so a hostile value can't escape DIR. Empty → null (skip).
function fileFor(key) {
  const safe = String(key || '').replace(/[^A-Za-z0-9_-]/g, '');
  return safe ? path.join(DIR, `${safe}.json`) : null;
}
const load = (file) => readJsonArray(file).filter((n) => n && typeof n.title === 'string');

export function record(pushKeys, { title, body, tag, url } = {}) {
  const rec = { id: genId(), ts: Date.now(), title: String(title ?? ''), body: String(body ?? '') };
  if (tag) rec.tag = String(tag);
  const safeUrl = sanitizeNotificationUrl(url);
  if (safeUrl) rec.url = safeUrl;
  for (const key of pushKeys || []) {
    const file = fileFor(key);
    if (!file) continue;
    const items = load(file);
    items.push(rec);
    writeJsonAtomic(file, items.length > CAP ? items.slice(items.length - CAP) : items);
  }
  return rec;
}

export function list(pushKey) {
  const file = fileFor(pushKey);
  return file ? load(file).reverse() : [];
}

export function remove(pushKey, id) {
  const file = fileFor(pushKey);
  if (!file) return false;
  const items = load(file);
  const kept = items.filter((n) => n.id !== id);
  if (kept.length === items.length) return false;
  writeJsonAtomic(file, kept);
  return true;
}
