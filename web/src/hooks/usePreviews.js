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
  // The preview the sheet is CURRENTLY showing. null → the window default (activePreview); non-null → an
  // ad-hoc dynamic preview opened from a tapped terminal URL (its own port + deep-link path), which is NOT
  // the window default (URL previews are named `<window>-<port>` so several can coexist). Decouples the
  // sheet's target from the per-window activePreview so a tapped URL can display without clobbering it.
  const [openTarget, setOpenTarget] = useState(null); // { name, kind:'dynamic', port, path, expiresAt } | null

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

  // What the sheet renders: the ad-hoc URL preview if one is open, else the window default.
  const shownPreview = openTarget || activePreview;
  const shownPath = openTarget?.path || '/';

  // A URL preview belongs to the window it was tapped in; drop it when the active window changes so it
  // can't linger over an unrelated window (activePreview is already window-scoped by name).
  useEffect(() => { setOpenTarget(null); }, [curPreviewName]);

  // Reset the sheet's open flag once there's nothing to show, so a later fresh preview doesn't pop the
  // sheet open on its own (the flag would otherwise stay true from a previous session).
  const hasShown = !!shownPreview;
  useEffect(() => { if (!hasShown) setPreviewSheetOpen(false); }, [hasShown]);

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
    setOpenTarget(null); // opening the window default → clear any ad-hoc URL target
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
    setOpenTarget(null); // window default → not an ad-hoc URL target
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

  // Open a tapped loopback URL through a dynamic-preview reverse-proxy: register `<window>-<port>` (so
  // several ports coexist), then show it in the sheet at the URL's deep-link `path`. Throws on failure
  // (e.g. the port isn't listening) so the caller can surface why — mirrors startDynamicPreview.
  const startUrlPreview = useCallback(async ({ port, path }) => {
    if (!curPreviewName) return;
    const name = `${curPreviewName}-${port}`;
    const res = await createPreview(name, { port }); // throws on failure
    await refreshPreviews();
    setOpenTarget({ name, kind: 'dynamic', port, path: path || '/', expiresAt: res?.expiresAt });
    setPreviewSheetOpen(true);
  }, [curPreviewName, refreshPreviews]);

  // stop/renew act on whatever the sheet is showing — the ad-hoc URL preview if open, else the window default.
  const stopPreview = useCallback(async () => {
    const target = openTarget || activePreview;
    if (!target) return;
    try {
      await deletePreview(target.name);
      if (openTarget && openTarget.name === target.name) setOpenTarget(null);
      await refreshPreviews();
    } catch { /* ignore */ }
  }, [openTarget, activePreview?.name, refreshPreviews]);
  const renewPreview = useCallback(async () => {
    const target = openTarget || activePreview;
    if (!target) return;
    const opts = target.kind === 'dynamic' ? { port: target.port } : { dir: target.dir };
    try {
      const res = await createPreview(target.name, opts);
      if (openTarget && openTarget.name === target.name) setOpenTarget((t) => (t ? { ...t, expiresAt: res?.expiresAt } : t));
      await refreshPreviews();
    } catch { /* ignore */ }
  }, [openTarget, activePreview?.name, activePreview?.kind, activePreview?.dir, activePreview?.port, refreshPreviews]);

  return {
    previews, previewDomain, dynamicEnabled,
    previewSheetOpen, setPreviewSheetOpen,
    activePreview, curPreviewName,
    shownPreview, shownPath,
    refreshPreviews, openPreviewSheet,
    startPreview, startDynamicPreview, startUrlPreview, stopPreview, renewPreview,
  };
}
