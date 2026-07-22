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
  setBrowserDefaultMode,
  upsertBrowserHistory,
} from '../browserState.js';
import { isBrowserAccessEnabled, setBrowserAccessEnabled } from '../storage.js';

function replaceTab(tabs, next) {
  return tabs.map((tab) => (tab.id === next.id ? { ...tab, ...next } : tab));
}

function normalizeServerTab(tab) {
  if (!tab) return tab;
  return { ...tab, mode: tab.mode === 'direct' ? 'direct' : 'proxy' };
}

function normalizeServerTabs(tabs) {
  return tabs.map(normalizeServerTab);
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

export function useBrowser({ enabled = true, browserProxy = false } = {}) {
  const [open, setOpenState] = useState(false);
  const [accessEnabled, setAccessEnabled] = useState(isBrowserAccessEnabled);
  const [consentOpen, setConsentOpen] = useState(false);
  const [pendingUrl, setPendingUrl] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [historyActive, setHistoryActive] = useState(true);
  const [closeAfter, setCloseAfterState] = useState(() => readBrowserPrefs().closeAfter);
  const [defaultMode, setDefaultModeState] = useState(() => readBrowserPrefs().defaultMode);
  const [history, setHistory] = useState(() => readBrowserHistory());
  const [error, setError] = useState(null);
  const enablePromise = useRef(null);
  const openRequest = useRef(null);
  const openEpoch = useRef(0);
  const navigateEpoch = useRef(new Map());
  const navigateQueue = useRef(new Map());
  const mutationGeneration = useRef(0);
  const browserProxyRef = useRef(browserProxy);
  const switchQueue = useRef(Promise.resolve());
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);
  const historyActiveRef = useRef(historyActive);
  const openRef = useRef(open);
  tabsRef.current = tabs;
  activeIdRef.current = activeId;
  historyActiveRef.current = historyActive;
  openRef.current = open;
  browserProxyRef.current = browserProxy;

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
  const beginOpenRequest = useCallback((signal) => {
    openRequest.current?.controller.abort();
    openRequest.current?.detachCaller?.();
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    const request = {
      controller,
      epoch: ++openEpoch.current,
      generation: ++mutationGeneration.current,
      previousVisibleId: tabsRef.current.find((tab) => tab.visible)?.id || null,
      detachCaller: () => signal?.removeEventListener('abort', abortFromCaller),
    };
    openRequest.current = request;
    return request;
  }, []);
  const finishOpenRequest = useCallback((request) => {
    request?.detachCaller?.();
    if (openRequest.current === request) openRequest.current = null;
  }, []);

  const recordHistory = useCallback((tab) => {
    if (!tab?.originalUrl) return;
    upsertBrowserHistory({
      url: tab.originalUrl,
      title: tab.title,
      visitedAt: Date.now(),
      lastMode: tab.mode,
    });
    setHistory(readBrowserHistory());
  }, []);

  const resyncLostWorker = useCallback(async (nextError, isCurrent = () => true) => {
    if (nextError?.status !== 404 && nextError?.status !== 503) return false;
    const generation = mutationGeneration.current;
    try {
      const { tabs: loaded = [] } = await getBrowserTabs();
      if (!isCurrent() || mutationGeneration.current !== generation) return true;
      const normalized = normalizeServerTabs(loaded);
      commitTabs(normalized);
      const visible = normalized.find((tab) => tab.visible);
      const selected = visible || normalized[0] || null;
      commitActiveId(selected?.id || null);
      commitHistoryActive(!selected);
      if (!visible) commitOpen(false);
      return true;
    } catch { return false; }
  }, [commitActiveId, commitHistoryActive, commitOpen, commitTabs]);

  useEffect(() => {
    if (!enabled || !accessEnabled) return undefined;
    let live = true;
    const generation = mutationGeneration.current;
    getBrowserTabs().then(({ tabs: loaded = [] }) => {
      if (!live || mutationGeneration.current !== generation) return;
      const normalized = normalizeServerTabs(loaded);
      commitTabs(normalized);
      const visible = normalized.find((tab) => tab.visible);
      const selected = visible || normalized[0] || null;
      commitActiveId(selected?.id || null);
      commitHistoryActive(!selected);
      commitOpen(!!visible);
    }).catch((nextError) => { if (live) setError(nextError); });
    return () => { live = false; };
  }, [commitActiveId, commitHistoryActive, commitOpen, commitTabs, enabled]); // access is loaded explicitly by enableAccess on first consent

  useEffect(() => () => {
    openRequest.current?.controller.abort();
    openRequest.current?.detachCaller?.();
  }, []);

  useEffect(() => {
    const timers = tabs
      .filter((tab) => !tab.visible && tab.expiresAt != null)
      .map((tab) => setTimeout(() => {
        mutationGeneration.current += 1;
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
    mutationGeneration.current += 1;
    const next = normalizeServerTab(await setBrowserTabVisible(id, visible, duration));
    commitTabs((current) => mirrorVisibleTab(current, next, duration));
    return next;
  }, [closeAfter, commitTabs]);

  const switchTab = useCallback((id) => {
    mutationGeneration.current += 1;
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
    mutationGeneration.current += 1;
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

  const openUrl = useCallback((input, { mode = defaultMode, signal } = {}) => {
    const url = normalizeBrowserInput(input);
    if (!url) {
      setError(new Error('browser URL must use http or https'));
      return Promise.resolve(null);
    }
    if (mode === 'proxy' && !browserProxy) {
      setError(new Error('browser proxy unavailable'));
      return Promise.resolve(null);
    }
    const request = beginOpenRequest(signal);
    if (!accessEnabled) {
      setPendingUrl({ url, mode, request });
      setConsentOpen(true);
      return Promise.resolve({ pending: true });
    }
    const task = (async () => {
      setError(null);
      try {
        if (request.controller.signal.aborted) return null;
        const created = normalizeServerTab(await createBrowserTab(
          url, closeAfter, mode, { signal: request.controller.signal },
        ));
        if (request.controller.signal.aborted || openRequest.current !== request) {
          await deleteBrowserTab(created.id).catch(() => {});
          return null;
        }
        commitTabs((current) => mirrorVisibleTab(current, created, closeAfter));
        commitActiveId(created.id);
        commitHistoryActive(false);
        commitOpen(true);
        return created;
      } catch (nextError) {
        if (request.controller.signal.aborted || openRequest.current !== request) return null;
        if (request.previousVisibleId && tabsRef.current.some((tab) => tab.id === request.previousVisibleId)) {
          try {
            const restored = await setBrowserTabVisible(request.previousVisibleId, true, closeAfter);
            if (!request.controller.signal.aborted && openRequest.current === request) {
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
      finishOpenRequest(request);
    });
    return task;
  }, [accessEnabled, beginOpenRequest, browserProxy, closeAfter, commitActiveId, commitHistoryActive, commitOpen, commitTabs, defaultMode, finishOpenRequest]);

  const enableAccess = useCallback(() => {
    if (enablePromise.current) return enablePromise.current;
    const task = (async () => {
      const expectedOpenEpoch = openEpoch.current;
      const expectedGeneration = mutationGeneration.current;
      const pending = pendingUrl;
      setBrowserAccessEnabled(true);
      setAccessEnabled(true);
      setConsentOpen(false);
      setError(null);
      try {
        const { tabs: loaded = [] } = await getBrowserTabs();
        const normalized = normalizeServerTabs(loaded);
        if (pending) {
          const { request } = pending;
          if (
            request.controller.signal.aborted
            || openEpoch.current !== request.epoch
            || openRequest.current !== request
            || mutationGeneration.current !== expectedGeneration
          ) {
            return;
          }
          if (pending.mode === 'proxy' && !browserProxyRef.current) {
            throw new Error('browser proxy unavailable');
          }
          const created = normalizeServerTab(await createBrowserTab(
            pending.url, closeAfter, pending.mode, { signal: request.controller.signal },
          ));
          if (request.controller.signal.aborted || openEpoch.current !== request.epoch || openRequest.current !== request) {
            await deleteBrowserTab(created.id).catch(() => {});
            return;
          }
          commitTabs(mirrorVisibleTab(normalized, created, closeAfter));
          commitActiveId(created.id);
          commitHistoryActive(false);
        } else {
          if (
            openEpoch.current !== expectedOpenEpoch
            || mutationGeneration.current !== expectedGeneration
          ) return;
          commitTabs(normalized);
          const selected = normalized.find((tab) => tab.visible) || normalized[0] || null;
          commitActiveId(selected?.id || null);
          commitHistoryActive(!selected);
        }
        commitOpen(true);
      } catch (nextError) {
        if (pending?.request && (
          pending.request.controller.signal.aborted
          || openEpoch.current !== pending.request.epoch
          || openRequest.current !== pending.request
        )) return;
        setError(nextError);
      } finally {
        if (pending?.request) {
          setPendingUrl((current) => (current?.request === pending.request ? null : current));
          finishOpenRequest(pending.request);
        }
      }
    })().finally(() => {
      if (enablePromise.current === task) enablePromise.current = null;
    });
    enablePromise.current = task;
    return task;
  }, [closeAfter, commitActiveId, commitHistoryActive, commitOpen, commitTabs, finishOpenRequest, pendingUrl]);

  const cancelAccess = useCallback(() => {
    pendingUrl?.request?.controller.abort();
    finishOpenRequest(pendingUrl?.request);
    setPendingUrl(null);
    setConsentOpen(false);
  }, [finishOpenRequest, pendingUrl]);

  const closeTab = useCallback(async (id) => {
    const closing = tabsRef.current.find((tab) => tab.id === id);
    if (!closing) return;
    mutationGeneration.current += 1;
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

  const navigateTab = useCallback(async (id, input, mode) => {
    const url = normalizeBrowserInput(input);
    if (!url) {
      setError(new Error('browser URL must use http or https'));
      return null;
    }
    const current = tabsRef.current.find((tab) => tab.id === id);
    const nextMode = mode || current?.mode || defaultMode;
    if (nextMode === 'proxy' && !browserProxy) {
      setError(new Error('browser proxy unavailable'));
      return null;
    }
    const epoch = (navigateEpoch.current.get(id) || 0) + 1;
    navigateEpoch.current.set(id, epoch);
    mutationGeneration.current += 1;
    const isCurrent = () => navigateEpoch.current.get(id) === epoch;
    const previous = navigateQueue.current.get(id) || Promise.resolve();
    const request = previous.catch(() => undefined).then(
      () => navigateBrowserTab(id, url, nextMode),
    );
    navigateQueue.current.set(id, request);
    try {
      const next = normalizeServerTab(await request);
      if (!isCurrent()) return null;
      commitTabs((current) => replaceTab(current, next));
      const committedMode = next.mode || nextMode;
      if (current && committedMode !== current.mode) {
        upsertBrowserHistory({
          url: next.originalUrl || url,
          title: next.title || current.title || '',
          visitedAt: Date.now(),
          lastMode: committedMode,
        });
        setHistory(readBrowserHistory());
      }
      setError(null);
      return next;
    } catch (nextError) {
      if (!isCurrent()) return null;
      if (!await resyncLostWorker(nextError, isCurrent) && isCurrent()) setError(nextError);
      return null;
    } finally {
      if (navigateQueue.current.get(id) === request) navigateQueue.current.delete(id);
    }
  }, [browserProxy, commitTabs, defaultMode, resyncLostWorker]);

  const updateTabMeta = useCallback((id, patch) => {
    const current = tabsRef.current.find((tab) => tab.id === id);
    if (!current) return;
    const url = normalizeBrowserInput(patch?.url) || current.originalUrl;
    const title = typeof patch?.title === 'string' ? patch.title : current.title;
    if (url === current.originalUrl && title === current.title) return;
    mutationGeneration.current += 1;
    commitTabs((all) => replaceTab(all, { ...current, originalUrl: url, title }));
    if (url && title?.trim()) {
      upsertBrowserHistory({ url, title, visitedAt: Date.now(), lastMode: current.mode });
      setHistory(readBrowserHistory());
    }
  }, [commitTabs]);

  const setCloseAfter = useCallback((value) => {
    setBrowserCloseAfter(value);
    const saved = readBrowserPrefs().closeAfter;
    setCloseAfterState(saved);
    return saved;
  }, []);

  const setDefaultMode = useCallback((mode) => {
    setBrowserDefaultMode(mode);
    const saved = readBrowserPrefs().defaultMode;
    setDefaultModeState(saved);
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
    defaultMode,
    proxyAvailable: browserProxy,
    history,
    error,
    openUrl,
    enableAccess,
    cancelAccess,
    switchTab,
    closeTab,
    setOpen,
    setCloseAfter,
    setDefaultMode,
    navigateTab,
    updateTabMeta,
    clearHistory,
  };
}
