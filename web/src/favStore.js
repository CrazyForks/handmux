// Per-mode "常用" lists — the source both for the FavDrawer and the chat page's horizontal quick-command
// bar. Each item is { kind: 'reply' | 'cmd', text }. 'reply' = a one-tap agent reply (ok/继续/…);
// 'cmd' = a command/slash-command; a few labels (ESC) are interpreted as terminal KEYS at dispatch time
// (see KEY_FAVS in BottomDock) rather than typed. Persisted to localStorage, keyed by mode, so command
// mode and agent mode keep separate customizable lists. The version in the key re-seeds the vibe preset
// below over any older default (one-time; a customised list is rebuilt from it).
const KEY = (mode) => `hm_favs6_${mode}`;

// Command-mode saved commands split into two lists: the GLOBAL one (scope 'command' — the original list,
// so existing commands stay put) shown first, and a PER-WINDOW one keyed by the tmux window id (following
// the preview-dir precedent of keying persistent per-window data by window.id). Each item may carry an
// `enter` flag: tapping it types the command AND presses Enter (runs it) rather than just typing it.
export const CMD_GLOBAL = 'command';
export const cmdScope = (windowId) => (windowId ? `command@${windowId}` : CMD_GLOBAL);

export const DEFAULT_FAVS = {
  command: [],
  agent: [
    { kind: 'key', text: 'Escape', label: 'Esc' },  // interrupt — fired as the Escape key, not typed
    { kind: 'key', text: 'Tab', label: 'Tab' },      // fired as the Tab key (grey — it's a key)
    { kind: 'key', text: 'BSpace', label: '⌫' },     // backspace — fired as the BSpace key, not text
    { kind: 'reply', text: 'ok' },
    { kind: 'reply', text: 'go on' },
    { kind: 'reply', text: '1' },
    { kind: 'reply', text: '2' },
    { kind: 'reply', text: '3' },
    { kind: 'cmd', text: '/compact' },
    { kind: 'cmd', text: '/clear' },
    { kind: 'cmd', text: '/model' },
  ],
};

export function loadFavs(mode) {
  try {
    const raw = localStorage.getItem(KEY(mode));
    if (raw) return JSON.parse(raw);
  } catch { /* fall through to defaults */ }
  return (DEFAULT_FAVS[mode] || []).map((f) => ({ ...f }));
}

export function saveFavs(mode, items) {
  try { localStorage.setItem(KEY(mode), JSON.stringify(items)); } catch { /* no localStorage */ }
  return items;
}

export function addFav(mode, item) {
  const items = loadFavs(mode);
  if (items.some((f) => f.text === item.text)) return items; // dedupe by text
  // A key fav (kind 'key') carries a pretty label (⌃C); a command carries the enter flag.
  const next = item.kind === 'key'
    ? { kind: 'key', text: item.text, label: item.label }
    : { kind: item.kind, text: item.text, enter: !!item.enter };
  return saveFavs(mode, [...items, next]);
}

export function removeFav(mode, text) {
  return saveFavs(mode, loadFavs(mode).filter((f) => f.text !== text));
}

// Replace the item currently stored as `oldText` with `item`, KEEPING its position (used by the editor's
// re-open-to-edit flow). No-op if oldText is gone; rejected if the new text would collide with a DIFFERENT
// existing item (dedupe by text, same rule as addFav).
export function updateFav(mode, oldText, item) {
  const items = loadFavs(mode);
  const i = items.findIndex((f) => f.text === oldText);
  if (i < 0) return items;
  if (items.some((f, k) => k !== i && f.text === item.text)) return items;
  const next = items.slice();
  next[i] = item.kind === 'key'
    ? { kind: 'key', text: item.text, label: item.label }
    : { kind: item.kind, text: item.text, enter: !!item.enter };
  return saveFavs(mode, next);
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
