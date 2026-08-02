import { useState, useEffect, useCallback, useRef } from 'react';
import { createPreview, deletePreview } from '../api.js';
import { previewName } from '../previewName.js';
import { getPreviewDir, setPreviewDir } from '../storage.js';

const STATIC_TABS_KEY = 'hm_static_preview_tabs1';

function readOpenTabs() {
  try {
    const value = JSON.parse(localStorage.getItem(STATIC_TABS_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item) => (
      item && /^[A-Za-z0-9._-]+$/.test(String(item.name || ''))
      && typeof item.dir === 'string' && item.dir.startsWith('/')
    )).map((item) => {
      const createdAt = Number(item.createdAt);
      return {
        name: String(item.name),
        dir: item.dir,
        ...(Number.isFinite(createdAt) && createdAt > 0 ? { createdAt } : {}),
      };
    });
  } catch {
    return [];
  }
}

function writeOpenTabs(tabs) {
  try {
    localStorage.setItem(STATIC_TABS_KEY, JSON.stringify(tabs.map(({ name, dir, createdAt }) => ({
      name,
      dir,
      ...(Number.isFinite(createdAt) && createdAt > 0 ? { createdAt } : {}),
    }))));
  } catch {
    // Keep the current in-memory tabs usable when device storage is unavailable.
  }
}

// Device-local static tabs backed by server leases. Opening/foregrounding ensures the lease exists;
// actual preview traffic renews it server-side, so there is no client heartbeat or expiry UI.
export function usePreviews(current) {
  const [openTabs, setOpenTabs] = useState(readOpenTabs);
  const [runtime, setRuntime] = useState({});
  const [activeTabName, setActiveTabName] = useState(null);
  const [selected, setSelected] = useState(false);
  const [error, setError] = useState(null);
  const openTabsRef = useRef(openTabs);
  const runtimeRef = useRef(runtime);
  openTabsRef.current = openTabs;
  runtimeRef.current = runtime;

  const commitOpenTabs = useCallback((update) => {
    const next = typeof update === 'function' ? update(openTabsRef.current) : update;
    openTabsRef.current = next;
    setOpenTabs(next);
    writeOpenTabs(next);
    return next;
  }, []);

  const setTabRuntime = useCallback((name, value) => {
    setRuntime((currentRuntime) => {
      const next = { ...currentRuntime, [name]: value };
      runtimeRef.current = next;
      return next;
    });
  }, []);

  const ensurePreview = useCallback(async (tab, { quiet = false, allowDetached = false } = {}) => {
    const prior = runtimeRef.current[tab.name];
    if (!quiet || prior?.status !== 'ready') {
      setTabRuntime(tab.name, { ...prior, status: 'ensuring', error: null });
    }
    try {
      const created = await createPreview(tab.name, { dir: tab.dir });
      if (typeof created?.url !== 'string' || !created.url) throw new Error('preview URL unavailable');
      // A user can close a restoring tab while registration is in flight. Release a late result instead
      // of leaving an invisible server lease behind. A newly chosen directory is intentionally detached
      // until registration succeeds and the tab is added below.
      if (!allowDetached && !openTabsRef.current.some((item) => item.name === tab.name)) {
        void deletePreview(tab.name).catch(() => {});
        return null;
      }
      setTabRuntime(tab.name, {
        status: 'ready',
        url: created.url,
        error: null,
      });
      setError(null);
      return created;
    } catch (nextError) {
      if (quiet && prior?.status === 'ready') return null;
      const normalized = nextError instanceof Error ? nextError : new Error(String(nextError));
      setTabRuntime(tab.name, { ...prior, status: 'error', error: normalized });
      setError(normalized);
      return null;
    }
  }, [setTabRuntime]);

  useEffect(() => {
    void Promise.all(openTabsRef.current.map((tab) => ensurePreview(tab)));
    const onVisibility = () => {
      if (!document.hidden) {
        void Promise.all(openTabsRef.current.map((tab) => ensurePreview(tab, { quiet: true })));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [ensurePreview]);

  const curPreviewName = current
    ? previewName({ session: current.session?.name, windowName: current.window?.name, windowId: current.window?.id })
    : null;
  const tabs = openTabs.map((saved) => ({
    ...saved,
    kind: 'static',
    status: runtime[saved.name]?.status || 'ensuring',
    url: runtime[saved.name]?.url || null,
    error: runtime[saved.name]?.error || null,
  }));
  const activeName = tabs.find((tab) => tab.name === activeTabName)?.name ?? tabs[0]?.name ?? null;
  const shownPreview = selected ? (tabs.find((tab) => tab.name === activeName) || null) : null;

  const startPreview = useCallback(async (dir) => {
    if (!curPreviewName) return null;
    const existing = openTabsRef.current.find((item) => item.name === curPreviewName);
    const tab = { name: curPreviewName, dir, createdAt: existing?.createdAt || Date.now() };
    const created = await ensurePreview(tab, { allowDetached: true });
    if (!created) return null;
    setPreviewDir(current?.window?.id, dir);
    commitOpenTabs((currentTabs) => [...currentTabs.filter((item) => item.name !== tab.name), tab]);
    setActiveTabName(tab.name);
    setSelected(true);
    return { ...tab, ...created };
  }, [commitOpenTabs, curPreviewName, current?.window?.id, ensurePreview]);

  const retryPreview = useCallback((name = activeName) => {
    const target = openTabsRef.current.find((tab) => tab.name === name);
    return target ? ensurePreview(target) : Promise.resolve(null);
  }, [activeName, ensurePreview]);

  const switchTab = useCallback((name) => {
    if (!openTabsRef.current.some((tab) => tab.name === name)) return;
    setActiveTabName(name);
    setSelected(true);
  }, []);
  const deactivate = useCallback(() => setSelected(false), []);

  const closeTab = useCallback(async (name) => {
    if (!name) return;
    setError(null);
    const remaining = commitOpenTabs((currentTabs) => currentTabs.filter((tab) => tab.name !== name));
    setRuntime((currentRuntime) => {
      const next = { ...currentRuntime };
      delete next[name];
      runtimeRef.current = next;
      return next;
    });
    if (activeTabName === name) {
      setActiveTabName(remaining[0]?.name || null);
      if (!remaining.length) setSelected(false);
    }
    try {
      await deletePreview(name);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError : new Error(String(nextError)));
    }
  }, [activeTabName, commitOpenTabs]);

  return {
    error,
    selected, deactivate,
    curPreviewName,
    tabs, activeName, shownPreview,
    startPreview, retryPreview,
    switchTab, closeTab,
    pane: current?.paneId || null,
    lastPreviewDir: getPreviewDir(current?.window?.id),
  };
}
