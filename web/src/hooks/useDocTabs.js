import { useState, useCallback } from 'react';
import { t } from '../i18n';

export const HOME_TAB = { key: 'home', type: 'home', name: t('doc.home') };

// Merge fresh metadata into a tab. `meta.content === undefined` (e.g. an image re-activate, which
// deliberately reuses its object URL) keeps the existing content; a provided content replaces it.
const mergeMeta = (tab, meta) => ({
  ...tab,
  type: meta.type ?? tab.type,
  name: meta.name ?? tab.name,
  content: meta.content !== undefined ? meta.content : tab.content,
});

// Pure: open a doc by absolute path. If a tab with that key already exists, activate it AND refresh
// its content from `meta` — the caller (openAbsDoc) refetches on every open, so a re-opened doc must
// show the latest bytes, never the stale copy the tab was carrying. Otherwise append a new doc tab.
export function openDocState(state, path, meta) {
  if (state.tabs.some((t) => t.key === path)) {
    return { tabs: state.tabs.map((t) => (t.key === path ? mergeMeta(t, meta) : t)), active: path };
  }
  const tab = { key: path, type: meta.type, name: meta.name, content: meta.content, path };
  return { tabs: [...state.tabs, tab], active: path };
}

// Pure: replace an existing doc tab's content from a refetch, WITHOUT changing which tab is active.
// Switching tabs activates instantly and refetches in the background; that async result landing after
// the user has switched away again must update the tab in place, never steal focus back. No-op if the
// tab is gone (closed mid-fetch).
export function refreshDocState(state, key, meta) {
  if (!state.tabs.some((t) => t.key === key)) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.key === key ? mergeMeta(t, meta) : t)) };
}

// Pure: close a doc tab (home is never closable). Closing the active tab falls back to its left
// neighbour (worst case: home).
export function closeTabState(state, key) {
  const i = state.tabs.findIndex((t) => t.key === key);
  if (i <= 0) return state; // not found, or the home tab at index 0
  const tabs = state.tabs.filter((t) => t.key !== key);
  const active = state.active === key ? state.tabs[i - 1].key : state.active;
  return { tabs, active };
}

export function useDocTabs() {
  const [state, setState] = useState({ tabs: [HOME_TAB], active: 'home' });
  const openDoc = useCallback((path, meta) => setState((s) => openDocState(s, path, meta)), []);
  const refreshDoc = useCallback((key, meta) => setState((s) => refreshDocState(s, key, meta)), []);
  const closeTab = useCallback((key) => setState((s) => closeTabState(s, key)), []);
  const activate = useCallback((key) => setState((s) => ({ ...s, active: key })), []);
  return { tabs: state.tabs, active: state.active, openDoc, refreshDoc, closeTab, activate };
}
