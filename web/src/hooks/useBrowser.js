import { useCallback, useEffect, useState } from 'react';
import {
  createBrowserTab,
  deleteBrowserTab,
  getBrowserTabs,
  navigateBrowserTab,
  setBrowserTabVisible,
} from '../api.js';
import {
  addBrowserHistory,
  clearBrowserHistory,
  normalizeBrowserInput,
  readBrowserHistory,
  readBrowserPrefs,
  setBrowserCloseAfter,
} from '../browserState.js';

function replaceTab(tabs, next) {
  return tabs.map((tab) => (tab.id === next.id ? { ...tab, ...next } : tab));
}

export function useBrowser({ enabled = true } = {}) {
  const [open, setOpenState] = useState(false);
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [historyActive, setHistoryActive] = useState(true);
  const [closeAfter, setCloseAfterState] = useState(() => readBrowserPrefs().closeAfter);
  const [history, setHistory] = useState(() => readBrowserHistory());
  const [error, setError] = useState(null);

  const recordHistory = useCallback((tab) => {
    if (!tab?.originalUrl) return;
    addBrowserHistory({ url: tab.originalUrl, title: tab.title, visitedAt: Date.now() });
    setHistory(readBrowserHistory());
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    getBrowserTabs().then(({ tabs: loaded = [] }) => {
      if (!live) return;
      setTabs(loaded);
      const visible = loaded.find((tab) => tab.visible);
      const selected = visible || loaded[0] || null;
      setActiveId(selected?.id || null);
      setHistoryActive(!selected);
      setOpenState(!!visible);
    }).catch((nextError) => { if (live) setError(nextError); });
    return () => { live = false; };
  }, [enabled]);

  useEffect(() => {
    const timers = tabs
      .filter((tab) => !tab.visible && tab.expiresAt != null)
      .map((tab) => setTimeout(() => {
        recordHistory(tab);
        setTabs((current) => current.filter((item) => item.id !== tab.id));
        setActiveId((current) => {
          if (current !== tab.id) return current;
          setHistoryActive(true);
          return null;
        });
      }, Math.max(0, tab.expiresAt - Date.now())));
    return () => timers.forEach(clearTimeout);
  }, [tabs, recordHistory]);

  const updateVisibility = useCallback(async (id, visible, duration = closeAfter) => {
    const next = await setBrowserTabVisible(id, visible, duration);
    setTabs((current) => replaceTab(current, next));
    return next;
  }, [closeAfter]);

  const switchTab = useCallback(async (id) => {
    setError(null);
    try {
      if (id === 'history') {
        if (open && activeId && !historyActive) await updateVisibility(activeId, false);
        setHistoryActive(true);
        return;
      }
      if (!tabs.some((tab) => tab.id === id)) return;
      if (open && activeId && activeId !== id && !historyActive) await updateVisibility(activeId, false);
      if (open && (activeId !== id || historyActive)) await updateVisibility(id, true);
      setActiveId(id);
      setHistoryActive(false);
    } catch (nextError) {
      setError(nextError);
    }
  }, [activeId, historyActive, open, tabs, updateVisibility]);

  const setOpen = useCallback(async (visible) => {
    setError(null);
    try {
      if (activeId && !historyActive) await updateVisibility(activeId, visible);
      setOpenState(visible);
    } catch (nextError) {
      setError(nextError);
    }
  }, [activeId, historyActive, updateVisibility]);

  const openUrl = useCallback(async (input) => {
    const url = normalizeBrowserInput(input);
    if (!url) {
      setError(new Error('browser URL must use http or https'));
      return null;
    }
    setError(null);
    try {
      if (open && activeId && !historyActive) await updateVisibility(activeId, false);
      const created = await createBrowserTab(url, closeAfter);
      setTabs((current) => [...current, created]);
      setActiveId(created.id);
      setHistoryActive(false);
      setOpenState(true);
      return created;
    } catch (nextError) {
      setError(nextError);
      return null;
    }
  }, [activeId, closeAfter, historyActive, open, updateVisibility]);

  const closeTab = useCallback(async (id) => {
    const closing = tabs.find((tab) => tab.id === id);
    if (!closing) return;
    setError(null);
    try {
      await deleteBrowserTab(id);
      recordHistory(closing);
      const remaining = tabs.filter((tab) => tab.id !== id);
      setTabs(remaining);
      if (activeId === id) {
        setActiveId(remaining[0]?.id || null);
        setHistoryActive(!remaining.length);
      }
    } catch (nextError) {
      setError(nextError);
    }
  }, [activeId, recordHistory, tabs]);

  const navigateTab = useCallback(async (id, input) => {
    const url = normalizeBrowserInput(input);
    if (!url) {
      setError(new Error('browser URL must use http or https'));
      return null;
    }
    try {
      const next = await navigateBrowserTab(id, url);
      setTabs((current) => replaceTab(current, next));
      setError(null);
      return next;
    } catch (nextError) {
      setError(nextError);
      return null;
    }
  }, []);

  const updateTabMeta = useCallback((id, patch) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? {
      ...tab,
      ...(typeof patch?.title === 'string' ? { title: patch.title } : {}),
      ...(normalizeBrowserInput(patch?.url) ? { originalUrl: normalizeBrowserInput(patch.url) } : {}),
    } : tab)));
  }, []);

  const setCloseAfter = useCallback((value) => {
    setBrowserCloseAfter(value);
    const saved = readBrowserPrefs().closeAfter;
    setCloseAfterState(saved);
    return saved;
  }, []);

  const clearHistory = useCallback(() => {
    clearBrowserHistory();
    setHistory([]);
  }, []);

  return {
    open,
    tabs,
    activeId,
    historyActive,
    closeAfter,
    history,
    error,
    openUrl,
    switchTab,
    closeTab,
    setOpen,
    setCloseAfter,
    navigateTab,
    updateTabMeta,
    clearHistory,
  };
}
