import { useRef, useState } from 'react';
import FileBrowser from './FileBrowser.jsx';
import { fetchPaneCwd } from '../api.js';
import { t } from '../i18n';

const noop = () => {};

// A directory-only picker overlay. Reuses FileBrowser in pickMode. `seedCwd` is the absolute dir to
// start at (null → $HOME); a seed outside $HOME / gone falls back to $HOME inside FileBrowser. The
// browser is controlled on `path`; onNavigate keeps it in sync. When `pane` is given, FileBrowser
// shows a "jump to current dir" shortcut (like the file manager) that snaps to the pane's live cwd.
// `allowMkdir` opts a picker into the new-folder button (off by default — a picker SELECTS an
// existing dir; view-type pickers like Git/preview must not offer file management). Create flows
// (new session/window) turn it on so you can make a fresh project dir before picking it.
export default function DirPicker({ open, seedCwd = null, hint = null, pane = null, allowMkdir = false, onPick, onClose, inset = 0 }) {
  const [path, setPath] = useState(seedCwd);
  // Re-seed to seedCwd the instant the picker opens, DURING render (not in an effect): an effect
  // landed one render late, so FileBrowser first mounted on $HOME and the right dir only appeared on
  // the *second* open. Setting state in render (guarded by the open-edge) makes FileBrowser mount on
  // the seed straight away. Pattern: React's "adjusting state when a prop changes".
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) { wasOpen.current = true; if (path !== seedCwd) setPath(seedCwd); }
  else if (!open && wasOpen.current) { wasOpen.current = false; }
  // Snap to the pane's LIVE cwd (re-fetched each press, so a mid-session `cd` is honored).
  const jumpToCwd = pane ? async () => {
    try { const { cwd } = await fetchPaneCwd(pane); if (cwd) setPath(cwd); } catch { /* ignore */ }
  } : null;
  if (!open) return null;
  return (
    <>
      <div className="settings-backdrop dirpick-backdrop" onClick={onClose} />
      <div
        className="settings-card dirpick-card"
        style={{ transform: `translate(-50%, calc(-50% + ${inset / 2}px))`, '--kb-inset': `${inset}px` }}
        role="dialog" aria-label={t('dirpicker.title')} aria-modal="true"
      >
        <div className="settings-head">
          <span className="settings-title">{t('dirpicker.title')}</span>
          <button className="settings-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        {hint && <div className="dirpick-hint">{hint}</div>}
        <FileBrowser
          path={path} onNavigate={setPath} onOpenDoc={noop}
          onJumpToCwd={jumpToCwd}
          pickMode allowMkdir={allowMkdir} onPick={onPick}
        />
      </div>
    </>
  );
}
