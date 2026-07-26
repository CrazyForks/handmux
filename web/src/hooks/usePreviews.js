import { useState, useEffect, useCallback } from 'react';
import { getPreviews, createPreview, deletePreview } from '../api.js';
import { previewName } from '../previewName.js';
import { setPreviewDir } from '../storage.js';

// The in-app preview subsystem: the registry state (previews/domain/dynamic flag), the visible-sheet flag,
// the current window's previews as switchable TABS, and every start/stop/renew/switch/open handler.
// `current` is App's { session, window, … } (for the per-window preview name). PreviewSheet is a normal
// child overlay when launched from Settings, so Settings stays mounted underneath it.
//
// Tabs: a window can have several live previews at once — its window-default (static dir or a dynamic
// port started from Settings, named `<window>`) plus any number of loopback-URL previews tapped from the
// terminal (named `<window>-<port>`). They're all registered in parallel server-side; the sheet shows one
// at a time and a tab strip switches between them (their iframes stay mounted, so switching keeps state).
// `activeTabName` picks which; `pathByName` remembers each tab's deep-link path (URL previews land on the
// tapped path, others on '/').
export function usePreviews(current) {
  const [previews, setPreviews] = useState([]);
  const [previewDomain, setPreviewDomain] = useState(null);
  const [dynamicEnabled, setDynamicEnabled] = useState(false);
  const [previewSheetOpen, setPreviewSheetOpen] = useState(false); // in-app preview sheet visible
  const [activeTabName, setActiveTabName] = useState(null);        // which tab the sheet shows
  const [pathByName, setPathByName] = useState({});               // name → deep-link path for that preview

  const refreshPreviews = useCallback(async () => {
    try {
      const r = await getPreviews();
      setPreviews(r.previews || []);
      setPreviewDomain(r.domain ?? null);
      setDynamicEnabled(!!r.dynamicEnabled);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { refreshPreviews(); }, [refreshPreviews]);

  // The preview name for the open session-window, and its window-default entry (if any, not expired).
  const curPreviewName = current
    ? previewName({ session: current.session?.name, windowName: current.window?.name, windowId: current.window?.id })
    : null;
  const activePreview = previews.find((p) => p.name === curPreviewName && p.expiresAt > Date.now()) || null;
  const activeExpiresAt = activePreview?.expiresAt ?? null;

  // Every live preview belonging to THIS window → the tab strip. The window default (`<window>`) sorts
  // first, then URL previews (`<window>-<port>`) by port. Each tab carries its remembered deep-link path.
  const isWindowPreview = (name) => !!curPreviewName && (name === curPreviewName || name.startsWith(`${curPreviewName}-`));
  const now = Date.now();
  const tabs = previews
    .filter((p) => p && p.expiresAt > now && isWindowPreview(p.name))
    .map((p) => ({ name: p.name, kind: p.kind, port: p.port, protocol: p.protocol, dir: p.dir, expiresAt: p.expiresAt, path: pathByName[p.name] || '/' }))
    .sort((a, b) => (a.name === curPreviewName ? -1 : b.name === curPreviewName ? 1 : (a.port || 0) - (b.port || 0)));

  // Effective active tab: the picked one if it's still live, else the first tab. shownPreview drives the
  // topbar icon and the sheet header; shownPath its initial iframe path.
  const activeName = tabs.find((tb) => tb.name === activeTabName)?.name ?? tabs[0]?.name ?? null;
  const shownPreview = tabs.find((tb) => tb.name === activeName) ?? null;
  const shownPath = shownPreview?.path || '/';

  // Tabs are window-scoped; on window change, forget the active pick so it can't linger over another window.
  useEffect(() => { setActiveTabName(null); }, [curPreviewName]);

  // Reset the sheet's open flag once this window has no previews, so a later fresh preview doesn't pop the
  // sheet open on its own (the flag would otherwise stay true from a previous session).
  const hasTabs = tabs.length > 0;
  useEffect(() => { if (!hasTabs) setPreviewSheetOpen(false); }, [hasTabs]);

  // Auto-clear the topbar icon when the window-default preview's TTL elapses (refetch drops the expired entry).
  useEffect(() => {
    if (activeExpiresAt == null) return undefined;
    const id = setTimeout(refreshPreviews, Math.max(0, activeExpiresAt - Date.now()) + 500);
    return () => clearTimeout(id);
  }, [activeExpiresAt, refreshPreviews]);

  // Open as a child layer. The shared history registry ensures Back/Escape returns to Settings when
  // launched there, while opening from the top bar still returns directly to the main screen.
  const openPreviewSheet = useCallback(() => {
    setActiveTabName(curPreviewName); // opening the window default → focus its tab
    setPreviewSheetOpen(true);
  }, [curPreviewName]);

  const startPreview = useCallback(async (dir) => {
    if (!curPreviewName) return;
    try {
      await createPreview(curPreviewName, { dir });
      setPreviewDir(current?.window?.id, dir); // remember → next open seeds here
      setPathByName((m) => ({ ...m, [curPreviewName]: '/' }));
      await refreshPreviews();
      openPreviewSheet();
    } catch { /* ignore */ }
  }, [curPreviewName, current?.window?.id, refreshPreviews, openPreviewSheet]);

  // Throws on failure (e.g. the port isn't listening) so Settings can show why instead of silently closing.
  const startDynamicPreview = useCallback(async (port) => {
    if (!curPreviewName) return;
    await createPreview(curPreviewName, { port }); // throws on failure → Settings keeps its inline error, stays open
    setPathByName((m) => ({ ...m, [curPreviewName]: '/' }));
    setActiveTabName(curPreviewName);
    await refreshPreviews();
    setPreviewSheetOpen(true);
  }, [curPreviewName, refreshPreviews]);

  // Open a tapped loopback URL through a dynamic-preview reverse-proxy: register `<window>-<port>` (so
  // several ports coexist as tabs), remember its deep-link path, focus its tab. Throws on failure (e.g.
  // the port isn't listening) so the caller can surface why — mirrors startDynamicPreview.
  const startUrlPreview = useCallback(async ({ protocol = 'http', port, path }) => {
    if (!curPreviewName) return;
    const name = `${curPreviewName}-${port}`;
    await createPreview(name, { port, protocol }); // throws on failure
    setPathByName((m) => ({ ...m, [name]: path || '/' }));
    setActiveTabName(name);
    await refreshPreviews();
    setPreviewSheetOpen(true);
  }, [curPreviewName, refreshPreviews]);

  const switchTab = useCallback((name) => setActiveTabName(name), []);

  // Close (stop) a tab: delete its registration + reap now. If it was active, the next render's activeName
  // falls back to the first remaining tab; if it was the last, the hasTabs effect closes the sheet.
  const closeTab = useCallback(async (name) => {
    if (!name) return;
    try {
      await deletePreview(name);
      setPathByName((m) => { const n = { ...m }; delete n[name]; return n; });
      if (activeTabName === name) setActiveTabName(null);
      await refreshPreviews();
    } catch { /* ignore */ }
  }, [activeTabName, refreshPreviews]);

  // The sheet's 停止 / 续期 popover acts on the ACTIVE tab.
  const stopPreview = useCallback(() => closeTab(activeName), [closeTab, activeName]);
  const renewPreview = useCallback(async () => {
    const target = tabs.find((tb) => tb.name === activeName);
    if (!target) return;
    const opts = target.kind === 'dynamic' ? { port: target.port, protocol: target.protocol || 'http' } : { dir: target.dir };
    try { await createPreview(target.name, opts); await refreshPreviews(); } catch { /* ignore */ }
  }, [tabs, activeName, refreshPreviews]);

  return {
    previews, previewDomain, dynamicEnabled,
    previewSheetOpen, setPreviewSheetOpen,
    activePreview, curPreviewName,
    tabs, activeName, shownPreview, shownPath,
    refreshPreviews, openPreviewSheet,
    startPreview, startDynamicPreview, startUrlPreview,
    switchTab, closeTab, stopPreview, renewPreview,
  };
}
