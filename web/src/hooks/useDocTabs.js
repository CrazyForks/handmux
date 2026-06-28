import { useState, useCallback } from 'react';
import { t } from '../i18n';

export const HOME_TAB = { key: 'home', type: 'home', name: t('doc.home') };

// Pure: open a doc by absolute path. If a tab with that key exists, just activate it (dedupe);
// otherwise append a doc tab carrying its rendered content + metadata.
export function openDocState(state, path, meta) {
  if (state.tabs.some((t) => t.key === path)) return { ...state, active: path };
  const tab = { key: path, type: meta.type, name: meta.name, content: meta.content, path };
  return { tabs: [...state.tabs, tab], active: path };
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
  const closeTab = useCallback((key) => setState((s) => closeTabState(s, key)), []);
  const activate = useCallback((key) => setState((s) => ({ ...s, active: key })), []);
  return { tabs: state.tabs, active: state.active, openDoc, closeTab, activate };
}
