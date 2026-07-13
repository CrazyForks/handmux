import { useState, useEffect, useCallback } from 'react';
import { getPreviews, createPreview, deletePreview } from '../api.js';
import { previewName } from '../previewName.js';
import { setPreviewDir } from '../storage.js';

// The in-app preview subsystem, lifted out of App verbatim: the registry state (previews/domain/dynamic
// flag), the visible-sheet flag, the current window's active preview, and every start/stop/renew/open
// handler. `current` is App's { session, window, … } (for the per-window preview name); `settingsOpen` +
// `setSettingsOpen` let the open/start handlers coordinate with the Settings sheet's history entry (see
// the back-popstate sequencing in startDynamicPreview). Behaviour is identical to when this lived in App.
export function usePreviews(current, { settingsOpen, setSettingsOpen }) {
  const [previews, setPreviews] = useState([]);
  const [previewDomain, setPreviewDomain] = useState(null);
  const [dynamicEnabled, setDynamicEnabled] = useState(false);
  const [previewSheetOpen, setPreviewSheetOpen] = useState(false); // in-app preview sheet visible

  const refreshPreviews = useCallback(async () => {
    try {
      const r = await getPreviews();
      setPreviews(r.previews || []);
      setPreviewDomain(r.domain ?? null);
      setDynamicEnabled(!!r.dynamicEnabled);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { refreshPreviews(); }, [refreshPreviews]);

  // The preview name for the open session-window, and its active entry (if any, not expired).
  const curPreviewName = current
    ? previewName({ session: current.session?.name, windowName: current.window?.name, windowId: current.window?.id })
    : null;
  const activePreview = previews.find((p) => p.name === curPreviewName && p.expiresAt > Date.now()) || null;
  const activeExpiresAt = activePreview?.expiresAt ?? null;

  // Reset the sheet's open flag once there's no active preview, so a later fresh preview doesn't
  // pop the sheet open on its own (the flag would otherwise stay true from a previous session).
  const hasActivePreview = !!activePreview;
  useEffect(() => { if (!hasActivePreview) setPreviewSheetOpen(false); }, [hasActivePreview]);

  // Auto-clear the topbar icon when this preview's TTL elapses (refetch drops the expired entry).
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
    if (settingsOpen) {
      setSettingsOpen(false);
      requestAnimationFrame(() => setPreviewSheetOpen(true));
    } else {
      setPreviewSheetOpen(true);
    }
  }, [settingsOpen, setSettingsOpen]);

  const startPreview = useCallback(async (dir) => {
    if (!curPreviewName) return;
    try {
      await createPreview(curPreviewName, { dir });
      setPreviewDir(current?.window?.id, dir); // remember → next open seeds here
      await refreshPreviews();
      openPreviewSheet();
    } catch { /* ignore */ }
  }, [curPreviewName, current?.window?.id, refreshPreviews, openPreviewSheet]);

  // Throws on failure (e.g. the port isn't listening) so Settings can show why instead of silently closing.
  const startDynamicPreview = useCallback(async (port) => {
    if (!curPreviewName) return;
    await createPreview(curPreviewName, { port }); // throws on failure → Settings keeps its inline error, stays open
    await refreshPreviews();
    // Auto-open the sheet — but NOT in the same frame we close Settings. Settings' useBackButton pops its
    // history entry on close (history.back() → an async popstate); if the sheet opened immediately its
    // freshly-mounted popstate listener would catch THAT back and close itself — the preview flashed open
    // then shut (the exact dynamic-preview symptom). The static path dodges this only by luck: its caller
    // closes Settings seconds earlier (before the network), so the back-popstate has long dissipated by the
    // time the sheet opens. Here we make the gap explicit — open the sheet only AFTER Settings' back-popstate,
    // so the sheet's listener mounts on a clean history stack. Fallback timer covers the (rare) case where
    // Settings wasn't back-tracked and no popstate fires.
    let opened = false;
    const openSheet = () => {
      if (opened) return;
      opened = true;
      window.removeEventListener('popstate', onPop);
      clearTimeout(fallback);
      setPreviewSheetOpen(true);
    };
    const onPop = () => openSheet();
    window.addEventListener('popstate', onPop);
    const fallback = setTimeout(openSheet, 300);
    setSettingsOpen(false); // → Settings' useBackButton cleanup → history.back() → popstate → openSheet()
  }, [curPreviewName, refreshPreviews, setSettingsOpen]);

  const stopPreview = useCallback(async () => {
    if (!curPreviewName) return;
    try { await deletePreview(curPreviewName); await refreshPreviews(); } catch { /* ignore */ }
  }, [curPreviewName, refreshPreviews]);
  const renewPreview = useCallback(async () => {
    if (!activePreview) return;
    const opts = activePreview.kind === 'dynamic' ? { port: activePreview.port } : { dir: activePreview.dir };
    try { await createPreview(activePreview.name, opts); await refreshPreviews(); } catch { /* ignore */ }
  }, [activePreview?.name, activePreview?.kind, activePreview?.dir, activePreview?.port, refreshPreviews]);

  return {
    previews, previewDomain, dynamicEnabled,
    previewSheetOpen, setPreviewSheetOpen,
    activePreview, curPreviewName,
    refreshPreviews, openPreviewSheet,
    startPreview, startDynamicPreview, stopPreview, renewPreview,
  };
}
