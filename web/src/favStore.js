import { shortcutIdentity } from './shortcutMerge.js';

// Only phone-local additions live here. Shared config provides shortcut content; a device-local layout may
// hide or reorder those shared actions without ever writing the shared server config. v7 makes text Enter
// behavior explicit, so same-text actions with different Enter behavior have distinct identities.
const KEY = (mode) => `hm_favs7_${mode}`;
const OLD_KEY = (mode) => `hm_favs6_${mode}`;

// Command-mode saved commands split into two lists: the GLOBAL one (scope 'command' — the original list,
// so existing commands stay put) shown first, and a PER-WINDOW one keyed by the tmux window id (following
// the preview-dir precedent of keying persistent per-window data by window.id). Each item may carry an
// `enter` flag: tapping it types the command AND presses Enter (runs it) rather than just typing it.
export const CMD_GLOBAL = 'command';
export const cmdScope = (windowId) => (windowId ? `command@${windowId}` : CMD_GLOBAL);

export const DEFAULT_FAVS = {
  command: [],
  agent: [],
};

const LEGACY_KEYS = {
  ESC: { kind: 'key', text: 'Escape', label: 'Esc' },
  Esc: { kind: 'key', text: 'Escape', label: 'Esc' },
  Tab: { kind: 'key', text: 'Tab', label: 'Tab' },
  '⌫': { kind: 'key', text: 'BSpace', label: '⌫' },
};

function migrateV6(mode, items) {
  return items.map((item) => {
    if (item.kind !== 'key' && LEGACY_KEYS[item.text]) return { ...LEGACY_KEYS[item.text] };
    if (item.kind === 'key') return { kind: 'key', text: item.text, label: item.label || item.text };
    return { kind: item.kind, text: item.text, enter: mode === 'agent' ? true : !!item.enter };
  });
}

export function loadFavs(mode) {
  try {
    const raw = localStorage.getItem(KEY(mode));
    if (raw) return JSON.parse(raw);
    const oldRaw = localStorage.getItem(OLD_KEY(mode));
    if (oldRaw) {
      const migrated = migrateV6(mode, JSON.parse(oldRaw));
      saveFavs(mode, migrated);
      return migrated;
    }
  } catch { /* fall through to defaults */ }
  return (DEFAULT_FAVS[mode] || []).map((f) => ({ ...f }));
}

export function saveFavs(mode, items) {
  try { localStorage.setItem(KEY(mode), JSON.stringify(items)); } catch { /* no localStorage */ }
  return items;
}

function storedFav(item) {
  return item.kind === 'key'
    ? { kind: 'key', text: item.text, label: item.label }
    : { kind: item.kind, text: item.text, enter: !!item.enter };
}

export function addFavResult(mode, item) {
  const items = loadFavs(mode);
  const identity = shortcutIdentity(item);
  if (items.some((f) => shortcutIdentity(f) === identity)) {
    return { ok: false, reason: 'conflict', items };
  }
  // A key fav (kind 'key') carries a pretty label (⌃C); a command carries the enter flag.
  const next = saveFavs(mode, [...items, storedFav(item)]);
  return { ok: true, items: next };
}

export function addFav(mode, item) {
  return addFavResult(mode, item).items;
}

export function removeFav(mode, text) {
  return saveFavs(mode, loadFavs(mode).filter((f) => f.text !== text));
}

export function removeFavByIdentity(mode, identity) {
  return saveFavs(mode, loadFavs(mode).filter((f) => shortcutIdentity(f) !== identity));
}

// Replace the exact identity while keeping its position. Same-text actions with different Enter behavior
// remain independently addressable throughout edit and cross-scope flows.
export function updateFavResult(mode, oldIdentity, item) {
  const items = loadFavs(mode);
  const i = items.findIndex((f) => shortcutIdentity(f) === oldIdentity);
  if (i < 0) return { ok: false, reason: 'missing', items };
  const newIdentity = shortcutIdentity(item);
  if (items.some((f, k) => k !== i && shortcutIdentity(f) === newIdentity)) {
    return { ok: false, reason: 'conflict', items };
  }
  const next = items.slice();
  next[i] = storedFav(item);
  return { ok: true, items: saveFavs(mode, next) };
}

export function updateFav(mode, oldText, item) {
  const old = loadFavs(mode).find((fav) => fav.text === oldText);
  if (!old) return loadFavs(mode);
  return updateFavResult(mode, shortcutIdentity(old), item).items;
}

// Move one item between scopes only after validating both lists. A target conflict is therefore a true
// no-op: neither source nor target is written, and callers can keep their UI/layout unchanged too.
export function transferFavResult(oldMode, oldIdentity, newMode, item) {
  if (oldMode === newMode) return updateFavResult(oldMode, oldIdentity, item);
  const source = loadFavs(oldMode);
  const target = loadFavs(newMode);
  if (!source.some((f) => shortcutIdentity(f) === oldIdentity)) {
    return { ok: false, reason: 'missing', source, target };
  }
  const newIdentity = shortcutIdentity(item);
  if (target.some((f) => shortcutIdentity(f) === newIdentity)) {
    return { ok: false, reason: 'conflict', source, target };
  }
  const nextSource = saveFavs(oldMode, source.filter((f) => shortcutIdentity(f) !== oldIdentity));
  const nextTarget = saveFavs(newMode, [...target, storedFav(item)]);
  return { ok: true, source: nextSource, target: nextTarget };
}

// Reorder one item by swapping it with its neighbour. dir < 0 = up, dir > 0 = down. No-op at the ends.
export function moveFav(mode, text, dir) {
  const items = loadFavs(mode);
  const i = items.findIndex((f) => f.text === text);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= items.length) return items;
  const next = items.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return saveFavs(mode, next);
}

// Swap two known visible neighbours at their real storage positions. Hidden effective-global duplicates may
// sit between them in the full window-local list, so swapping raw adjacent indexes would leave the UI still.
export function moveFavBeside(mode, text, neighbourText) {
  const items = loadFavs(mode);
  const i = items.findIndex((f) => f.text === text);
  const j = items.findIndex((f) => f.text === neighbourText);
  if (i < 0 || j < 0 || i === j) return items;
  const next = items.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return saveFavs(mode, next);
}

export function moveFavBesideByIdentity(mode, identity, neighbourIdentity) {
  const items = loadFavs(mode);
  const i = items.findIndex((f) => shortcutIdentity(f) === identity);
  const j = items.findIndex((f) => shortcutIdentity(f) === neighbourIdentity);
  if (i < 0 || j < 0 || i === j) return items;
  const next = items.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return saveFavs(mode, next);
}
