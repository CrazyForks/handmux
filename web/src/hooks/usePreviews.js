import { useState, useEffect, useCallback, useRef } from 'react';
import { getPreviews, createPreview, deletePreview, previewUrl } from '../api.js';
import { previewName } from '../previewName.js';
import { getPreviewDir, setPreviewDir } from '../storage.js';

const STATIC_TABS_KEY = 'hm_static_preview_tabs1';
const KEEPALIVE_MS = 20 * 60_000;

function readOpenTabs() {
  try {
    const value = JSON.parse(localStorage.getItem(STATIC_TABS_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item) => (
      item && /^[A-Za-z0-9._-]+$/.test(String(item.name || ''))
      && typeof item.dir === 'string' && item.dir.startsWith('/')
    )).map((item) => ({
      name: String(item.name), dir: item.dir, keepAlive: item.keepAlive !== false,
    }));
  } catch {
    return [];
  }
}

function writeOpenTabs(tabs) {
  try {
    localStorage.setItem(STATIC_TABS_KEY, JSON.stringify(tabs.map(({ name, dir, keepAlive }) => ({
      name, dir, keepAlive,
    }))));
  } catch {
    // Keep the current in-memory tabs usable when device storage is unavailable.
  }
}

// Static-directory registry and device-local tabs used by the permanent Web Previewer.
export function usePreviews(current) {
  const [previews, setPreviews] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [openTabs, setOpenTabs] = useState(readOpenTabs);
  const [activeTabName, setActiveTabName] = useState(null);
  const [selected, setSelected] = useState(false);
  const [error, setError] = useState(null);
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;

  const commitOpenTabs = useCallback((update) => {
    const next = typeof update === 'function' ? update(openTabsRef.current) : update;
    openTabsRef.current = next;
    setOpenTabs(next);
    writeOpenTabs(next);
    return next;
  }, []);

  const refreshPreviews = useCallback(async () => {
    try {
      const r = await getPreviews();
      setPreviews(r.previews || []);
      setLoaded(true);
      return r.previews || [];
    } catch (nextError) {
      setError(nextError);
      return null;
    }
  }, []);
  useEffect(() => { refreshPreviews(); }, [refreshPreviews]);

  // The preview name for the open session-window, and its window-default entry (if any, not expired).
  const curPreviewName = current
    ? previewName({ session: current.session?.name, windowName: current.window?.name, windowId: current.window?.id })
    : null;
  const activePreview = previews.find((p) => p.name === curPreviewName && p.expiresAt > Date.now()) || null;
  const liveByName = new Map(previews.map((entry) => [entry.name, entry]));
  const tabs = openTabs.map((saved) => {
    const live = liveByName.get(saved.name);
    return {
      ...saved,
      kind: 'static',
      status: live ? 'running' : (loaded ? 'stopped' : 'checking'),
      expiresAt: live?.expiresAt ?? null,
      url: live ? previewUrl(live) : null,
    };
  });
  const activeName = tabs.find((tab) => tab.name === activeTabName)?.name ?? tabs[0]?.name ?? null;
  const shownPreview = selected ? (tabs.find((tab) => tab.name === activeName) || null) : null;

  const addOpenTab = useCallback((entry, keepAlive = true) => {
    commitOpenTabs((currentTabs) => {
      const next = currentTabs.filter((item) => item.name !== entry.name);
      next.push({ name: entry.name, dir: entry.dir, keepAlive });
      return next;
    });
    setActiveTabName(entry.name);
    setSelected(true);
  }, [commitOpenTabs]);

  const openPreview = useCallback((entryOrName) => {
    const name = typeof entryOrName === 'string' ? entryOrName : entryOrName?.name;
    const live = previews.find((entry) => entry.name === name);
    const saved = openTabsRef.current.find((entry) => entry.name === name);
    const entry = live || saved;
    if (!entry) return false;
    addOpenTab(entry, live ? true : saved.keepAlive);
    return true;
  }, [addOpenTab, previews]);

  const startPreview = useCallback(async (dir) => {
    if (!curPreviewName) return null;
    try {
      const created = await createPreview(curPreviewName, { dir });
      setPreviewDir(current?.window?.id, dir);
      await refreshPreviews();
      const entry = { ...created, dir };
      addOpenTab(entry, true);
      setError(null);
      return entry;
    } catch (nextError) {
      setError(nextError);
      return null;
    }
  }, [addOpenTab, curPreviewName, current?.window?.id, refreshPreviews]);

  const switchTab = useCallback((name) => {
    if (!openTabsRef.current.some((tab) => tab.name === name)) return;
    setActiveTabName(name);
    setSelected(true);
  }, []);
  const deactivate = useCallback(() => setSelected(false), []);

  // Closing a tab is device-local. Stopping the server-side preview is an explicit separate action.
  const closeTab = useCallback((name) => {
    if (!name) return;
    const remaining = commitOpenTabs((currentTabs) => currentTabs.filter((tab) => tab.name !== name));
    if (activeTabName === name) {
      setActiveTabName(remaining[0]?.name || null);
      if (!remaining.length) setSelected(false);
    }
  }, [activeTabName, commitOpenTabs]);

  const stopPreview = useCallback(async (name = activeName) => {
    const target = openTabsRef.current.find((tab) => tab.name === name)
      || previews.find((tab) => tab.name === name);
    if (!target) return false;
    try {
      await deletePreview(name);
      commitOpenTabs((currentTabs) => currentTabs.map((tab) => (
        tab.name === name ? { ...tab, keepAlive: false } : tab
      )));
      await refreshPreviews();
      setError(null);
      return true;
    } catch (nextError) {
      setError(nextError);
      return false;
    }
  }, [activeName, commitOpenTabs, previews, refreshPreviews]);

  const restartPreview = useCallback(async (name = activeName) => {
    const target = openTabsRef.current.find((tab) => tab.name === name);
    if (!target) return false;
    try {
      await createPreview(target.name, { dir: target.dir });
      commitOpenTabs((currentTabs) => currentTabs.map((tab) => (
        tab.name === name ? { ...tab, keepAlive: true } : tab
      )));
      await refreshPreviews();
      setError(null);
      return true;
    } catch (nextError) {
      setError(nextError);
      return false;
    }
  }, [activeName, commitOpenTabs, refreshPreviews]);

  const renewOpenTabs = useCallback(async () => {
    const targets = openTabsRef.current.filter((tab) => tab.keepAlive);
    if (!targets.length) return;
    const results = await Promise.allSettled(targets.map((tab) => (
      createPreview(tab.name, { dir: tab.dir })
    )));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) {
      setError(failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason)));
    } else {
      setError(null);
    }
    await refreshPreviews();
  }, [refreshPreviews]);

  useEffect(() => {
    void renewOpenTabs();
    const timer = setInterval(() => { void renewOpenTabs(); }, KEEPALIVE_MS);
    const onVisibility = () => { if (!document.hidden) void renewOpenTabs(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [renewOpenTabs]);

  return {
    previews, loaded, error,
    selected, deactivate,
    activePreview, curPreviewName,
    tabs, activeName, shownPreview,
    refreshPreviews, openPreview,
    startPreview, restartPreview,
    switchTab, closeTab, stopPreview,
    pane: current?.paneId || null,
    lastPreviewDir: getPreviewDir(current?.window?.id),
  };
}
