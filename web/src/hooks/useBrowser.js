import { useCallback, useEffect, useRef, useState } from 'react';
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
import { isBrowserAccessEnabled, setBrowserAccessEnabled } from '../storage.js';

function replaceTab(tabs, next) {
  return tabs.map((tab) => (tab.id === next.id ? { ...tab, ...next } : tab));
}

export function useBrowser({ enabled = true } = {}) {
  const [open, setOpenState] = useState(false);
  const [accessEnabled, setAccessEnabled] = useState(isBrowserAccessEnabled);
  const [consentOpen, setConsentOpen] = useState(false);
  const [pendingUrl, setPendingUrl] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [historyActive, setHistoryActive] = useState(true);
  const [closeAfter, setCloseAfterState] = useState(() => readBrowserPrefs().closeAfter);
  const [history, setHistory] = useState(() => readBrowserHistory());
  const [error, setError] = useState(null);
  const enablePromise = useRef(null);
  const openPromises = useRef(new Map());

  const recordHistory = useCallback((tab) => {
    if (!tab?.originalUrl) return;
    addBrowserHistory({ url: tab.originalUrl, title: tab.title, visitedAt: Date.now() });
    setHistory(readBrowserHistory());
  }, []);

  useEffect(() => {
    if (!enabled || !accessEnabled) return undefined;
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
  }, [enabled]); // access is loaded explicitly by enableAccess on first consent

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
    if (visible && !accessEnabled) {
      setConsentOpen(true);
      return;
    }
    setError(null);
    try {
      if (activeId && !historyActive) await updateVisibility(activeId, visible);
      setOpenState(visible);
    } catch (nextError) {
      setError(nextError);
    }
  }, [accessEnabled, activeId, historyActive, updateVisibility]);

  const openUrl = useCallback((input, options = {}) => {
    const url = normalizeBrowserInput(input);
    if (!url) {
      setError(new Error('browser URL must use http or https'));
      return Promise.resolve(null);
    }
    if (!accessEnabled) {
      setPendingUrl(url);
      setConsentOpen(true);
      return Promise.resolve({ pending: true });
    }
    const pending = openPromises.current.get(url);
    if (pending) return pending;
    const task = (async () => {
      setError(null);
      try {
        if (open && activeId && !historyActive) await updateVisibility(activeId, false);
        const created = options.signal
          ? await createBrowserTab(url, closeAfter, { signal: options.signal })
          : await createBrowserTab(url, closeAfter);
        setTabs((current) => [...current, created]);
        setActiveId(created.id);
        setHistoryActive(false);
        setOpenState(true);
        return created;
      } catch (nextError) {
        if (options.signal?.aborted) return null;
        setError(nextError);
        return null;
      }
    })().finally(() => {
      if (openPromises.current.get(url) === task) openPromises.current.delete(url);
    });
    openPromises.current.set(url, task);
    return task;
  }, [accessEnabled, activeId, closeAfter, historyActive, open, updateVisibility]);

  const enableAccess = useCallback(() => {
    if (enablePromise.current) return enablePromise.current;
    const task = (async () => {
      setBrowserAccessEnabled(true);
      setAccessEnabled(true);
      setConsentOpen(false);
      setError(null);
      try {
        const { tabs: loaded = [] } = await getBrowserTabs();
        if (pendingUrl) {
          const created = await createBrowserTab(pendingUrl, closeAfter);
          setTabs([...loaded, created]);
          setActiveId(created.id);
          setHistoryActive(false);
          setPendingUrl(null);
        } else {
          setTabs(loaded);
          const selected = loaded.find((tab) => tab.visible) || loaded[0] || null;
          setActiveId(selected?.id || null);
          setHistoryActive(!selected);
        }
        setOpenState(true);
      } catch (nextError) {
        setError(nextError);
      }
    })().finally(() => {
      if (enablePromise.current === task) enablePromise.current = null;
    });
    enablePromise.current = task;
    return task;
  }, [closeAfter, pendingUrl]);

  const cancelAccess = useCallback(() => {
    setPendingUrl(null);
    setConsentOpen(false);
  }, []);

  const closeTab = useCallback(async (id) => {
    const closing = tabs.find((tab) => tab.id === id);
    if (!closing) return;
    setError(null);
    try {
      await deleteBrowserTab(id);
      recordHistory(closing);
      let remaining = tabs.filter((tab) => tab.id !== id);
      if (activeId === id) {
        if (open && remaining.length) {
          const shown = await updateVisibility(remaining[0].id, true);
          remaining = replaceTab(remaining, shown);
        }
        setActiveId(remaining[0]?.id || null);
        setHistoryActive(!remaining.length);
      }
      setTabs(remaining);
    } catch (nextError) {
      setError(nextError);
    }
  }, [activeId, open, recordHistory, tabs, updateVisibility]);

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
    accessEnabled,
    consentOpen,
    tabs,
    activeId,
    historyActive,
    closeAfter,
    history,
    error,
    openUrl,
    enableAccess,
    cancelAccess,
    switchTab,
    closeTab,
    setOpen,
    setCloseAfter,
    navigateTab,
    updateTabMeta,
    clearHistory,
  };
}
