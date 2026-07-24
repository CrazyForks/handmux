import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acquireBrowserProxyLease,
  clearBrowserProxyProfile,
  deleteBrowserProxyLease,
  getBrowserProxyStatus,
  navigateBrowserProxyLease,
  setBrowserProxyProfilePrefs,
} from '../api.js';
import {
  clearBrowserHistory,
  clearBrowserTabs,
  deleteBrowserHistoryEntry,
  normalizeBrowserInput,
  readBrowserHistory,
  readBrowserPrefs,
  readBrowserTabs,
  setBrowserCloseAfter,
  setBrowserDefaultMode,
  setPersistProxyLogin as persistProxyLoginLocally,
  setProxyLoginRetentionDays as persistProxyLoginRetentionLocally,
  upsertBrowserHistory,
  writeBrowserTabs,
} from '../browserState.js';
import { isBrowserAccessEnabled, setBrowserAccessEnabled } from '../storage.js';
import { t } from '../i18n';

const runtimeTab = (tab) => ({
  ...tab,
  ...(tab.mode === 'direct' ? { url: tab.originalUrl } : {}),
});
const PROXY_RETRY_DELAYS = [250, 500, 1000, 2000, 4000, 5000];

function transientProxyError(error) {
  return [502, 503, 504].includes(error?.status)
    || /(?:timeout|browser unavailable|failed to fetch|networkerror|load failed)/i.test(error?.message || '');
}

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

function localId() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function useBrowser({ enabled = true, browserProxy = false } = {}) {
  const accessAtMount = useRef(isBrowserAccessEnabled()).current;
  const initial = useRef(null);
  if (!initial.current) {
    initial.current = accessAtMount
      ? readBrowserTabs()
      : { tabs: [], activeId: null, open: false, historyActive: true };
  }
  const [accessEnabled, setAccessEnabled] = useState(accessAtMount);
  const [tabs, setTabs] = useState(() => initial.current.tabs.map(runtimeTab));
  const [activeId, setActiveId] = useState(initial.current.activeId);
  const [open, setOpenState] = useState(initial.current.open && accessAtMount);
  const [historyActive, setHistoryActive] = useState(initial.current.historyActive);
  const [consentOpen, setConsentOpen] = useState(false);
  const [pendingUrl, setPendingUrl] = useState(null);
  const [history, setHistory] = useState(readBrowserHistory);
  const [error, setError] = useState(null);
  const prefs = readBrowserPrefs();
  const [closeAfter, setCloseAfterState] = useState(prefs.closeAfter);
  const [defaultMode, setDefaultModeState] = useState(prefs.defaultMode);
  const [persistProxyLogin, setPersistProxyLoginState] = useState(prefs.persistProxyLogin);
  const [proxyLoginRetentionDays, setProxyLoginRetentionDaysState] = useState(prefs.proxyLoginRetentionDays);
  const tabsRef = useRef(tabs);
  const activeRef = useRef(activeId);
  const openRef = useRef(open);
  const historyRef = useRef(historyActive);
  const bindingPromises = useRef(new Map());
  const proxyGeneration = useRef(null);
  const openSequence = useRef(0);
  const navigateSequence = useRef(new Map());
  const navigateQueues = useRef(new Map());
  const pendingUrlRef = useRef(pendingUrl);
  const enablePromise = useRef(null);
  const profileQueue = useRef(Promise.resolve());
  const recoveryWarningShown = useRef(false);
  const pendingProfilePrefs = useRef({
    persist: prefs.persistProxyLogin,
    retentionDays: prefs.proxyLoginRetentionDays,
  });
  const navigatingTabs = useRef(new Map());
  tabsRef.current = tabs;
  activeRef.current = activeId;
  openRef.current = open;
  historyRef.current = historyActive;

  const commitTabs = useCallback((update) => {
    const next = typeof update === 'function' ? update(tabsRef.current) : update;
    tabsRef.current = next;
    setTabs(next);
    return next;
  }, []);
  const commitActive = useCallback((value) => {
    activeRef.current = value;
    setActiveId(value);
  }, []);
  const commitOpen = useCallback((value) => {
    openRef.current = value;
    setOpenState(value);
  }, []);
  const commitHistory = useCallback((value) => {
    historyRef.current = value;
    setHistoryActive(value);
  }, []);

  useEffect(() => {
    writeBrowserTabs({ tabs, activeId, open, historyActive });
  }, [activeId, historyActive, open, tabs]);

  const recordHistory = useCallback((tab) => {
    if (!tab?.originalUrl) return;
    upsertBrowserHistory({
      url: tab.originalUrl, title: tab.title, lastMode: tab.mode, visitedAt: Date.now(),
    });
    setHistory(readBrowserHistory());
  }, []);

  const release = useCallback((tab) => {
    if (tab?.mode === 'proxy') deleteBrowserProxyLease(tab.id).catch(() => {});
  }, []);

  const enqueueProfileOperation = useCallback((work) => {
    const operation = profileQueue.current.catch(() => {}).then(work);
    profileQueue.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, []);

  const applyBinding = useCallback((id, binding) => {
    if (binding.generation != null && proxyGeneration.current !== binding.generation) {
      proxyGeneration.current = binding.generation;
      commitTabs((current) => current.map((item) => (
        item.mode === 'proxy' && item.id !== id
          ? { ...item, url: undefined, channel: undefined, generation: undefined }
          : item
      )));
    }
    let result = null;
    commitTabs((current) => current.map((item) => {
      if (item.id !== id || item.mode !== 'proxy') return item;
      result = {
        ...item,
        url: binding.url,
        channel: binding.channel,
        generation: binding.generation,
      };
      return result;
    }));
    return result;
  }, [commitTabs]);

  const ensureBinding = useCallback((id, { force = false } = {}) => {
    const tab = tabsRef.current.find((item) => item.id === id);
    if (!tab || tab.mode !== 'proxy' || (tab.url && !force)) return Promise.resolve(tab || null);
    if (!browserProxy) {
      setError(new Error(t('browser.proxyUnavailable')));
      return Promise.resolve(null);
    }
    const requestedUrl = tab.originalUrl;
    const existing = bindingPromises.current.get(id);
    if (existing?.url === requestedUrl) return existing.promise;
    let profileWarning = false;
    const stillCurrent = () => {
      const current = tabsRef.current.find((item) => item.id === id);
      return current?.mode === 'proxy' && current.originalUrl === requestedUrl;
    };
    const pending = (async () => {
      for (let attempt = 0; attempt <= PROXY_RETRY_DELAYS.length; attempt += 1) {
        if (!stillCurrent()) return null;
        let status;
        try {
          status = await getBrowserProxyStatus();
        } catch (nextError) {
          if (!transientProxyError(nextError)) throw nextError;
        }
        if (!stillCurrent()) return null;
        let transientFailure = !status?.ready;
        if (status?.ready) {
          try {
            const binding = await enqueueProfileOperation(async () => {
              if (!stillCurrent()) return null;
              let profile;
              try {
                const prefs = readBrowserPrefs();
                profile = await setBrowserProxyProfilePrefs({
                  persist: prefs.persistProxyLogin,
                  retentionDays: prefs.proxyLoginRetentionDays,
                });
              } catch (nextError) {
                if (!transientProxyError(nextError)) {
                  throw new Error(t('browser.profileSyncFailed'));
                }
                throw nextError;
              }
              if (!stillCurrent()) return null;
              profileWarning = profile?.warning === 'profile-recovery-failed';
              if (profileWarning && !recoveryWarningShown.current) {
                recoveryWarningShown.current = true;
                setError(new Error(t('browser.profileRecoveryWarning')));
              }
              return acquireBrowserProxyLease(id, requestedUrl);
            });
            if (!stillCurrent()) return null;
            return binding;
          } catch (nextError) {
            if (!transientProxyError(nextError)) throw nextError;
            transientFailure = true;
          }
        }
        if (!transientFailure) return null;
        if (attempt === PROXY_RETRY_DELAYS.length) {
          throw new Error(t('browser.loadFailed'));
        }
        await wait(PROXY_RETRY_DELAYS[attempt]);
      }
      return null;
    })().then((binding) => {
      if (!binding) return null;
      const current = tabsRef.current.find((item) => item.id === id);
      if (!current || current.mode !== 'proxy' || current.originalUrl !== requestedUrl) {
        deleteBrowserProxyLease(id).catch(() => {});
        return null;
      }
      const result = applyBinding(id, binding);
      if (!profileWarning) setError(null);
      return result;
    }).catch((nextError) => {
      setError(nextError);
      return null;
    }).finally(() => {
      if (bindingPromises.current.get(id)?.promise === pending) {
        bindingPromises.current.delete(id);
      }
    });
    bindingPromises.current.set(id, { url: requestedUrl, promise: pending });
    return pending;
  }, [applyBinding, browserProxy, enqueueProfileOperation]);

  const recoverBinding = useCallback((id) => {
    commitTabs((current) => current.map((tab) => tab.id === id && tab.mode === 'proxy'
      ? { ...tab, url: undefined, channel: undefined, generation: undefined }
      : tab));
    return ensureBinding(id, { force: true });
  }, [commitTabs, ensureBinding]);

  const refreshProxyStatus = useCallback(async () => {
    if (!enabled || !accessEnabled || !browserProxy) return;
    try {
      const status = await getBrowserProxyStatus();
      if (status.generation == null) return;
      const changed = proxyGeneration.current != null && proxyGeneration.current !== status.generation;
      proxyGeneration.current = status.generation;
      if (changed) {
        commitTabs((current) => current.map((tab) => tab.mode === 'proxy'
          ? { ...tab, url: undefined, channel: undefined, generation: undefined }
          : tab));
      }
    } catch {
      // Status is advisory: device-owned tabs survive proxy worker outages.
    }
  }, [accessEnabled, browserProxy, commitTabs, enabled]);

  const hideTab = useCallback((tab, duration = closeAfter) => ({
    ...tab,
    deadline: duration == null ? null : Date.now() + duration * 60_000,
  }), [closeAfter]);

  const pruneExpired = useCallback(() => {
    const now = Date.now();
    const expired = tabsRef.current.filter((tab) => tab.deadline != null && tab.deadline <= now);
    if (!expired.length) return;
    const ids = new Set(expired.map((tab) => tab.id));
    expired.forEach((tab) => { recordHistory(tab); release(tab); });
    const remaining = commitTabs((current) => current.filter((tab) => !ids.has(tab.id)));
    if (ids.has(activeRef.current)) {
      const next = remaining[0] || null;
      commitActive(next?.id || null);
      commitHistory(!next);
    }
  }, [commitActive, commitHistory, commitTabs, recordHistory, release]);

  useEffect(() => {
    pruneExpired();
    void refreshProxyStatus();
    const onVisibility = () => {
      if (!document.hidden) {
        pruneExpired();
        void refreshProxyStatus();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pruneExpired, refreshProxyStatus]);

  useEffect(() => {
    const deadlines = tabs.filter((tab) => tab.deadline != null).map((tab) => tab.deadline);
    if (!deadlines.length) return undefined;
    const timer = setTimeout(pruneExpired, Math.max(0, Math.min(...deadlines) - Date.now()));
    return () => clearTimeout(timer);
  }, [pruneExpired, tabs]);

  const openUrl = useCallback(async (input, { mode = defaultMode, force = false } = {}) => {
    const sequence = ++openSequence.current;
    const url = normalizeBrowserInput(input);
    if (!url) { setError(new Error('browser URL must use http or https')); return null; }
    if (!accessEnabled && !force) {
      const pending = { url, mode };
      pendingUrlRef.current = pending;
      setPendingUrl(pending);
      setConsentOpen(true);
      return { pending: true };
    }
    if (mode === 'proxy' && !browserProxy) {
      setError(new Error(t('browser.proxyUnavailable')));
      return null;
    }
    const id = localId();
    const created = runtimeTab({
      id, mode, originalUrl: url, title: '', deadline: null,
    });
    commitTabs((current) => [...current.map((tab) => (
      tab.id === activeRef.current && openRef.current && !historyRef.current ? hideTab(tab) : tab
    )), created]);
    commitActive(id);
    commitHistory(false);
    commitOpen(true);
    setError(null);
    if (mode === 'proxy') await ensureBinding(id);
    else await Promise.resolve();
    if (sequence !== openSequence.current) {
      const stale = tabsRef.current.find((tab) => tab.id === id);
      if (stale) {
        release(stale);
        commitTabs((current) => current.filter((tab) => tab.id !== id));
      }
      return null;
    }
    return tabsRef.current.find((tab) => tab.id === id) || created;
  }, [accessEnabled, browserProxy, commitActive, commitHistory, commitOpen, commitTabs, defaultMode, ensureBinding, hideTab, release]);

  const enableAccess = useCallback(() => {
    if (enablePromise.current) return enablePromise.current;
    const pending = pendingUrlRef.current;
    pendingUrlRef.current = null;
    setPendingUrl(null);
    const operation = (async () => {
      setBrowserAccessEnabled(true);
      setAccessEnabled(true);
      setConsentOpen(false);
      if (pending) return openUrl(pending.url, { mode: pending.mode, force: true });
      commitOpen(true);
      return true;
    })().finally(() => {
      if (enablePromise.current === operation) enablePromise.current = null;
    });
    enablePromise.current = operation;
    return operation;
  }, [commitOpen, openUrl]);

  const cancelAccess = useCallback(() => {
    pendingUrlRef.current = null;
    setPendingUrl(null);
    setConsentOpen(false);
  }, []);

  const disableAccess = useCallback(() => {
    tabsRef.current.forEach(release);
    commitTabs([]);
    commitActive(null);
    commitHistory(true);
    commitOpen(false);
    clearBrowserTabs();
    setBrowserAccessEnabled(false);
    setAccessEnabled(false);
    setConsentOpen(false);
    pendingUrlRef.current = null;
  }, [commitActive, commitHistory, commitOpen, commitTabs, release]);
  const setEnabled = useCallback((value) => {
    if (!value) {
      disableAccess();
      return false;
    }
    setBrowserAccessEnabled(true);
    setAccessEnabled(true);
    return true;
  }, [disableAccess]);

  const switchTab = useCallback(async (id) => {
    if (id === 'history') {
      if (openRef.current && activeRef.current && !historyRef.current) {
        commitTabs((current) => current.map((tab) => tab.id === activeRef.current ? hideTab(tab) : tab));
      }
      commitHistory(true);
      return true;
    }
    const target = tabsRef.current.find((tab) => tab.id === id);
    if (!target) return false;
    commitTabs((current) => current.map((tab) => {
      if (tab.id === id) return { ...tab, deadline: null };
      if (tab.id === activeRef.current && openRef.current && !historyRef.current) return hideTab(tab);
      return tab;
    }));
    commitActive(id);
    commitHistory(false);
    if (openRef.current) await ensureBinding(id);
    return true;
  }, [commitActive, commitHistory, commitTabs, ensureBinding, hideTab]);

  const setOpen = useCallback(async (visible) => {
    if (visible && !accessEnabled) { setConsentOpen(true); return false; }
    if (activeRef.current && !historyRef.current) {
      commitTabs((current) => current.map((tab) => (
        tab.id === activeRef.current ? (visible ? { ...tab, deadline: null } : hideTab(tab)) : tab
      )));
    }
    commitOpen(visible);
    if (visible && activeRef.current && !historyRef.current) await ensureBinding(activeRef.current);
    return true;
  }, [accessEnabled, commitOpen, commitTabs, ensureBinding, hideTab]);

  const closeTab = useCallback((id) => {
    const index = tabsRef.current.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const closing = tabsRef.current[index];
    recordHistory(closing);
    release(closing);
    const remaining = commitTabs((current) => current.filter((tab) => tab.id !== id));
    if (activeRef.current === id) {
      const next = remaining[Math.min(index, remaining.length - 1)] || null;
      commitActive(next?.id || null);
      commitHistory(!next);
      if (next && openRef.current) {
        commitTabs((current) => current.map((tab) => tab.id === next.id ? { ...tab, deadline: null } : tab));
        void ensureBinding(next.id);
      }
    }
  }, [commitActive, commitHistory, commitTabs, ensureBinding, recordHistory, release]);

  const navigateTab = useCallback(async (id, input, requestedMode) => {
    const url = normalizeBrowserInput(input);
    const current = tabsRef.current.find((tab) => tab.id === id);
    if (!url || !current) return null;
    const mode = requestedMode || current.mode;
    if (mode === 'proxy' && !browserProxy) return null;
    const sequence = (navigateSequence.current.get(id) || 0) + 1;
    navigateSequence.current.set(id, sequence);
    navigatingTabs.current.set(id, sequence);
    if (current.mode === 'proxy' && mode === 'direct') release(current);
    commitTabs((all) => all.map((tab) => tab.id === id ? {
      ...tab,
      mode,
      originalUrl: url,
      title: '',
      ...(mode === 'direct'
        ? { url, channel: undefined, generation: undefined }
        : (current.mode === 'proxy'
          ? {}
          : { url: undefined, channel: undefined, generation: undefined })),
    } : tab));
    if (mode === 'proxy') {
      const prior = navigateQueues.current.get(id) || Promise.resolve();
      const request = prior.catch(() => {}).then(() => (
        current.mode === 'proxy'
          ? navigateBrowserProxyLease(id, url)
          : ensureBinding(id, { force: true })
      ));
      navigateQueues.current.set(id, request);
      try {
        const binding = await request;
        if (navigateQueues.current.get(id) === request) navigateQueues.current.delete(id);
        if (navigateSequence.current.get(id) === sequence) {
          if (binding?.url) {
            applyBinding(id, binding);
            setError(null);
          } else {
            navigatingTabs.current.delete(id);
          }
        }
      } catch (nextError) {
        if (navigateQueues.current.get(id) === request) navigateQueues.current.delete(id);
        if (navigateSequence.current.get(id) === sequence) {
          commitTabs((all) => all.map((tab) => tab.id === id
            ? { ...tab, url: undefined, channel: undefined, generation: undefined }
            : tab));
          setError(nextError);
          navigatingTabs.current.delete(id);
        }
      }
    } else if (navigateSequence.current.get(id) === sequence) {
      navigatingTabs.current.delete(id);
    }
    return tabsRef.current.find((tab) => tab.id === id) || null;
  }, [applyBinding, browserProxy, commitTabs, ensureBinding, release]);

  const updateTabMeta = useCallback((id, patch) => {
    if (navigatingTabs.current.has(id)) return null;
    let updated;
    commitTabs((all) => all.map((tab) => {
      if (tab.id !== id) return tab;
      updated = {
        ...tab,
        originalUrl: normalizeBrowserInput(patch?.url) || tab.originalUrl,
        title: typeof patch?.title === 'string' ? patch.title : tab.title,
      };
      return updated;
    }));
    if (updated?.title) {
      upsertBrowserHistory({
        url: updated.originalUrl, title: updated.title, lastMode: updated.mode, visitedAt: Date.now(),
      });
      setHistory(readBrowserHistory());
    }
  }, [commitTabs]);

  const markBindingReady = useCallback((id, channel) => {
    const tab = tabsRef.current.find((item) => item.id === id);
    if (tab?.mode === 'proxy' && tab.channel === channel) navigatingTabs.current.delete(id);
  }, []);

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
  const setHistoryMode = useCallback((entry, mode) => {
    upsertBrowserHistory({ ...entry, lastMode: mode });
    const next = readBrowserHistory();
    setHistory(next);
    return next.find((item) => item.url === entry?.url) || null;
  }, []);

  const saveProfilePrefs = useCallback(async (change) => {
    const next = {
      persist: change.persist ?? pendingProfilePrefs.current.persist,
      retentionDays: change.retentionDays ?? pendingProfilePrefs.current.retentionDays,
    };
    pendingProfilePrefs.current = next;
    try {
      const response = await enqueueProfileOperation(async () => {
        const saved = await setBrowserProxyProfilePrefs(next);
        persistProxyLoginLocally(saved.persist);
        persistProxyLoginRetentionLocally(saved.retentionDays);
        return saved;
      });
      setPersistProxyLoginState(response.persist);
      setProxyLoginRetentionDaysState(response.retentionDays);
      return true;
    } catch {
      setError(new Error(t('browser.profileSaveFailed')));
      return false;
    }
  }, [enqueueProfileOperation]);

  const clearProxyLogin = useCallback(async (origin = null) => {
    try {
      await clearBrowserProxyProfile(origin);
      const removed = tabsRef.current.filter((tab) => tab.mode === 'proxy' && (
        origin === null || new URL(tab.originalUrl).origin === origin
      ));
      removed.forEach(release);
      const ids = new Set(removed.map((tab) => tab.id));
      commitTabs((current) => current.filter((tab) => !ids.has(tab.id)));
      if (ids.has(activeRef.current)) {
        const next = tabsRef.current[0] || null;
        commitActive(next?.id || null);
        commitHistory(!next);
      }
      return true;
    } catch {
      setError(new Error(t('browser.profileClearFailed')));
      return false;
    }
  }, [commitActive, commitHistory, commitTabs, release]);

  return {
    open, accessEnabled, consentOpen, tabs, activeId, historyActive, closeAfter, defaultMode,
    persistProxyLogin, proxyLoginRetentionDays, proxyAvailable: browserProxy, history, error,
    openUrl, enableAccess, disableAccess, setEnabled, cancelAccess, switchTab, closeTab, setOpen,
    setCloseAfter, setDefaultMode,
    setPersistProxyLogin: (value) => saveProfilePrefs({ persist: !!value }),
    setProxyLoginRetentionDays: (value) => saveProfilePrefs({ retentionDays: value }),
    clearProxyLogin, setHistoryMode, navigateTab, ensureBinding, recoverBinding,
    markBindingReady, updateTabMeta,
    deleteHistory: (entry) => { deleteBrowserHistoryEntry(entry); setHistory(readBrowserHistory()); },
    clearHistory: () => { clearBrowserHistory(); setHistory([]); },
  };
}
