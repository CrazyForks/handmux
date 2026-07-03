// Per-mode "常用" lists shown in the FavDrawer. Each item is { kind: 'reply' | 'cmd', text }.
// 'reply' = a one-tap agent reply (ok/继续/…). 'cmd' = a command/slash-command. Persisted to
// localStorage, keyed by mode, so command mode and agent mode keep separate customizable lists.
const KEY = (mode) => `hm_favs_${mode}`;

export const DEFAULT_FAVS = {
  command: [],
  agent: [
    { kind: 'reply', text: 'ok' },
    { kind: 'reply', text: '继续' },
    { kind: 'reply', text: 'yes' },
    { kind: 'reply', text: 'no' },
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
  return saveFavs(mode, [...items, { kind: item.kind, text: item.text }]);
}

export function removeFav(mode, text) {
  return saveFavs(mode, loadFavs(mode).filter((f) => f.text !== text));
}
