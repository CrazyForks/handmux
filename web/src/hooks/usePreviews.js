import { useState, useEffect, useCallback } from 'react';
import { getPreviews, createPreview, deletePreview } from '../api.js';
import { previewName } from '../previewName.js';
import { setPreviewDir } from '../storage.js';

// Static directory preview state. Website and local-port browsing belongs to the permanent Browser tool.
export function usePreviews(current, { settingsOpen, setSettingsOpen }) {
  const [previews, setPreviews] = useState([]);
  const [previewSheetOpen, setPreviewSheetOpen] = useState(false); // in-app preview sheet visible
  const [activeTabName, setActiveTabName] = useState(null);        // which tab the sheet shows
  const [pathByName, setPathByName] = useState({});               // name → deep-link path for that preview

  const refreshPreviews = useCallback(async () => {
    try {
      const r = await getPreviews();
      setPreviews(r.previews || []);
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
  const isWindowPreview = (name) => !!curPreviewName && name === curPreviewName;
  const now = Date.now();
  const tabs = previews
    .filter((p) => p && p.expiresAt > now && isWindowPreview(p.name))
    .map((p) => ({ name: p.name, kind: 'static', dir: p.dir, expiresAt: p.expiresAt, path: pathByName[p.name] || '/' }));

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

  // Open the preview sheet. If Settings is open (launching/opening from there), close Settings FIRST
  // and open the sheet on the NEXT frame — never in the same commit. Both overlays balance the Back
  // button via useBackButton (each pushes one history entry); swapping them in one commit makes the
  // closing Settings' cleanup `history.back()` pop the sheet's just-pushed entry, whose fresh popstate
  // listener then fires → the sheet flashes open and immediately closes back to the main page.
  const openPreviewSheet = useCallback(() => {
    setActiveTabName(curPreviewName); // opening the window default → focus its tab
    if (settingsOpen) {
      setSettingsOpen(false);
      requestAnimationFrame(() => setPreviewSheetOpen(true));
    } else {
      setPreviewSheetOpen(true);
    }
  }, [settingsOpen, setSettingsOpen, curPreviewName]);

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
    try { await createPreview(target.name, { dir: target.dir }); await refreshPreviews(); } catch { /* ignore */ }
  }, [tabs, activeName, refreshPreviews]);

  return {
    previews,
    previewSheetOpen, setPreviewSheetOpen,
    activePreview, curPreviewName,
    tabs, activeName, shownPreview, shownPath,
    refreshPreviews, openPreviewSheet,
    startPreview,
    switchTab, closeTab, stopPreview, renewPreview,
  };
}
