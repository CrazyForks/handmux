import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createBrowserTab,
  deleteBrowserTab,
  getBrowserTabs,
  navigateBrowserTab,
  setBrowserTabVisible,
} from '../api.js';
import {
  clearBrowserHistory,
  normalizeBrowserInput,
  readBrowserHistory,
  readBrowserPrefs,
  setBrowserCloseAfter,
  upsertBrowserHistory,
} from '../browserState.js';
import { isBrowserAccessEnabled, setBrowserAccessEnabled } from '../storage.js';

function replaceTab(tabs, next) {
  return tabs.map((tab) => (tab.id === next.id ? { ...tab, ...next } : tab));
}

function mirrorVisibleTab(tabs, next, closeAfter) {
  if (!next.visible) return replaceTab(tabs, next);
  const hiddenAt = Date.now();
  let found = false;
  const updated = tabs.map((tab) => {
    if (tab.id === next.id) {
      found = true;
      return { ...tab, ...next };
    }
    if (!tab.visible) return tab;
    return {
      ...tab,
      visible: false,
      hiddenAt,
      expiresAt: closeAfter == null ? null : hiddenAt + closeAfter * 60_000,
    };
  });
  return found ? updated : [...updated, next];
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
  const openRequest = useRef(null);
  const switchQueue = useRef(Promise.resolve());
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);
  const historyActiveRef = useRef(historyActive);
  const openRef = useRef(open);
  tabsRef.current = tabs;
  activeIdRef.current = activeId;
  historyActiveRef.current = historyActive;
  openRef.current = open;

  const commitTabs = useCallback((update) => {
    const next = typeof update === 'function' ? update(tabsRef.current) : update;
    tabsRef.current = next;
    setTabs(next);
    return next;
  }, []);
  const commitActiveId = useCallback((update) => {
    const next = typeof update === 'function' ? update(activeIdRef.current) : update;
    activeIdRef.current = next;
    setActiveId(next);
    return next;
  }, []);
  const commitHistoryActive = useCallback((next) => {
    historyActiveRef.current = next;
    setHistoryActive(next);
  }, []);
  const commitOpen = useCallback((next) => {
    openRef.current = next;
    setOpenState(next);
  }, []);
  const enqueueTransition = useCallback((work) => {
    const task = switchQueue.current.then(work);
    switchQueue.current = task.then(() => undefined, () => undefined);
    return task;
  }, []);

  const recordHistory = useCallback((tab) => {
    if (!tab?.originalUrl) return;
    upsertBrowserHistory({ url: tab.originalUrl, title: tab.title, visitedAt: Date.now() });
    setHistory(readBrowserHistory());
  }, []);

  const resyncLostWorker = useCallback(async (nextError) => {
    if (nextError?.status !== 404 && nextError?.status !== 503) return false;
    try {
      const { tabs: loaded = [] } = await getBrowserTabs();
      commitTabs(loaded);
      const visible = loaded.find((tab) => tab.visible);
      const selected = visible || loaded[0] || null;
      commitActiveId(selected?.id || null);
      commitHistoryActive(!selected);
      if (!visible) commitOpen(false);
      return true;
    } catch { return false; }
  }, [commitActiveId, commitHistoryActive, commitOpen, commitTabs]);

  useEffect(() => {
    if (!enabled || !accessEnabled) return undefined;
    let live = true;
    getBrowserTabs().then(({ tabs: loaded = [] }) => {
      if (!live) return;
      commitTabs(loaded);
      const visible = loaded.find((tab) => tab.visible);
      const selected = visible || loaded[0] || null;
      commitActiveId(selected?.id || null);
      commitHistoryActive(!selected);
      commitOpen(!!visible);
    }).catch((nextError) => { if (live) setError(nextError); });
    return () => { live = false; };
  }, [commitActiveId, commitHistoryActive, commitOpen, commitTabs, enabled]); // access is loaded explicitly by enableAccess on first consent

  useEffect(() => () => openRequest.current?.controller.abort(), []);

  useEffect(() => {
    const timers = tabs
      .filter((tab) => !tab.visible && tab.expiresAt != null)
      .map((tab) => setTimeout(() => {
        recordHistory(tab);
        commitTabs((current) => current.filter((item) => item.id !== tab.id));
        commitActiveId((current) => {
          if (current !== tab.id) return current;
          commitHistoryActive(true);
          return null;
        });
      }, Math.max(0, tab.expiresAt - Date.now())));
    return () => timers.forEach(clearTimeout);
  }, [commitActiveId, commitHistoryActive, commitTabs, tabs, recordHistory]);

  const updateVisibility = useCallback(async (id, visible, duration = closeAfter) => {
    const next = await setBrowserTabVisible(id, visible, duration);
    commitTabs((current) => mirrorVisibleTab(current, next, duration));
    return next;
  }, [closeAfter, commitTabs]);

  const switchTab = useCallback((id) => {
    return enqueueTransition(async () => {
      setError(null);
      try {
        const currentActiveId = activeIdRef.current;
        const currentHistoryActive = historyActiveRef.current;
        if (id === 'history') {
          if (openRef.current && currentActiveId && !currentHistoryActive) {
            await updateVisibility(currentActiveId, false);
          }
          commitHistoryActive(true);
          return true;
        }
        if (!tabsRef.current.some((tab) => tab.id === id)) return false;
        if (openRef.current) await updateVisibility(id, true);
        if (!tabsRef.current.some((tab) => tab.id === id)) return false;
        commitActiveId(id);
        commitHistoryActive(false);
        return true;
      } catch (nextError) {
        const recovered = await resyncLostWorker(nextError);
        if (!recovered) setError(nextError);
        return false;
      }
    });
  }, [commitActiveId, commitHistoryActive, enqueueTransition, resyncLostWorker, updateVisibility]);

  const setOpen = useCallback((visible) => {
    if (visible && !accessEnabled) {
      setConsentOpen(true);
      return Promise.resolve(false);
    }
    return enqueueTransition(async () => {
      setError(null);
      try {
        if (activeIdRef.current && !historyActiveRef.current) {
          await updateVisibility(activeIdRef.current, visible);
        }
        commitOpen(visible);
        return true;
      } catch (nextError) {
        const recovered = await resyncLostWorker(nextError);
        if (!visible) commitOpen(false);
        if (!recovered && visible) setError(nextError);
        return !visible;
      }
    });
  }, [accessEnabled, commitOpen, enqueueTransition, resyncLostWorker, updateVisibility]);

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
    openRequest.current?.controller.abort();
    const controller = new AbortController();
    const request = {
      controller,
      previousVisibleId: tabsRef.current.find((tab) => tab.visible)?.id || null,
    };
    openRequest.current = request;
    const abortFromCaller = () => controller.abort();
    if (options.signal?.aborted) abortFromCaller();
    else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const task = (async () => {
      setError(null);
      try {
        if (controller.signal.aborted) return null;
        const created = await createBrowserTab(url, closeAfter, { signal: controller.signal });
        if (controller.signal.aborted || openRequest.current !== request) {
          await deleteBrowserTab(created.id).catch(() => {});
          return null;
        }
        commitTabs((current) => mirrorVisibleTab(current, created, closeAfter));
        commitActiveId(created.id);
        commitHistoryActive(false);
        commitOpen(true);
        return created;
      } catch (nextError) {
        if (controller.signal.aborted || openRequest.current !== request) return null;
        if (request.previousVisibleId && tabsRef.current.some((tab) => tab.id === request.previousVisibleId)) {
          try {
            const restored = await setBrowserTabVisible(request.previousVisibleId, true, closeAfter);
            if (!controller.signal.aborted && openRequest.current === request) {
              commitTabs((current) => mirrorVisibleTab(current, restored, closeAfter));
              commitActiveId(restored.id);
              commitHistoryActive(false);
              commitOpen(true);
            }
          } catch { /* preserve the original create error */ }
        }
        setError(nextError);
        return null;
      }
    })().finally(() => {
      options.signal?.removeEventListener('abort', abortFromCaller);
      if (openRequest.current === request) openRequest.current = null;
    });
    return task;
  }, [accessEnabled, closeAfter, commitActiveId, commitHistoryActive, commitOpen, commitTabs]);

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
          commitTabs(mirrorVisibleTab(loaded, created, closeAfter));
          commitActiveId(created.id);
          commitHistoryActive(false);
          setPendingUrl(null);
        } else {
          commitTabs(loaded);
          const selected = loaded.find((tab) => tab.visible) || loaded[0] || null;
          commitActiveId(selected?.id || null);
          commitHistoryActive(!selected);
        }
        commitOpen(true);
      } catch (nextError) {
        setError(nextError);
      }
    })().finally(() => {
      if (enablePromise.current === task) enablePromise.current = null;
    });
    enablePromise.current = task;
    return task;
  }, [closeAfter, commitActiveId, commitHistoryActive, commitOpen, commitTabs, pendingUrl]);

  const cancelAccess = useCallback(() => {
    setPendingUrl(null);
    setConsentOpen(false);
  }, []);

  const closeTab = useCallback(async (id) => {
    const closing = tabsRef.current.find((tab) => tab.id === id);
    if (!closing) return;
    setError(null);
    try {
      await deleteBrowserTab(id);
      recordHistory(closing);
      const remaining = commitTabs((current) => current.filter((tab) => tab.id !== id));
      if (activeIdRef.current === id) {
        if (openRef.current && remaining.length) {
          await updateVisibility(remaining[0].id, true);
        }
        commitActiveId(remaining[0]?.id || null);
        commitHistoryActive(!remaining.length);
      }
    } catch (nextError) {
      if (!await resyncLostWorker(nextError)) setError(nextError);
    }
  }, [commitActiveId, commitHistoryActive, commitTabs, recordHistory, resyncLostWorker, updateVisibility]);

  const navigateTab = useCallback(async (id, input) => {
    const url = normalizeBrowserInput(input);
    if (!url) {
      setError(new Error('browser URL must use http or https'));
      return null;
    }
    try {
      const next = await navigateBrowserTab(id, url);
      commitTabs((current) => replaceTab(current, next));
      setError(null);
      return next;
    } catch (nextError) {
      if (!await resyncLostWorker(nextError)) setError(nextError);
      return null;
    }
  }, [commitTabs, resyncLostWorker]);

  const updateTabMeta = useCallback((id, patch) => {
    const current = tabsRef.current.find((tab) => tab.id === id);
    if (!current) return;
    const url = normalizeBrowserInput(patch?.url) || current.originalUrl;
    const title = typeof patch?.title === 'string' ? patch.title : current.title;
    if (url === current.originalUrl && title === current.title) return;
    commitTabs((all) => replaceTab(all, { ...current, originalUrl: url, title }));
    if (url && title?.trim()) {
      upsertBrowserHistory({ url, title, visitedAt: Date.now() });
      setHistory(readBrowserHistory());
    }
  }, [commitTabs]);

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
