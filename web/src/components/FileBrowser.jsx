// web/src/components/FileBrowser.jsx
import { useEffect, useRef, useState } from 'react';
import { fetchDir, downloadFile, uploadFile, createDir } from '../api.js';
import { UPLOAD_ACCEPT, splitUploadable } from '../uploadTypes.js';
import { joinPath } from '../docPath.js';
import { FolderIcon, FileIcon, ImageIcon, ArrowUpIcon, DownloadIcon, LocateIcon, FolderPlusIcon, UploadIcon, CopyIcon } from './icons.jsx';
import ActionSheet from './ActionSheet.jsx';
import { t } from '../i18n';

const DOC_EXT_RE = /\.(?:md|markdown|html|htm|txt|log|sh)$/i;

// A very full directory (thousands of files) is both slow to render every row and hard to scan.
// We render at most this many rows; when more match, a hint nudges the user to type into the path
// box (which live-filters the trailing fragment) to narrow down.
const MAX_ROWS = 300;

// Split a typed path into its directory part (everything up to & including the last '/') and the
// trailing fragment the user is filtering by. "/a/b/c" → { dir:"/a/b/", frag:"c" };
// "/a/b/" → { dir:"/a/b/", frag:"" }; "foo" → { dir:"", frag:"foo" }.
export function splitPath(input) {
  const i = input.lastIndexOf('/');
  if (i < 0) return { dir: '', frag: input };
  return { dir: input.slice(0, i + 1), frag: input.slice(i + 1) };
}

const stripSlash = (p) => p.replace(/\/+$/, '') || '/';

// abs (under `root`) → root-relative; the root itself → ''.
const toRel = (abs, root) =>
  abs === root ? '' : abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : abs;

// The allowed root (home or an extra root like /tmp) that contains `abs` — longest match wins.
// Falls back to `home` when nothing matches (or no roots were reported by an older server).
const rootOf = (abs, roots, home) => {
  let best = null;
  for (const r of roots || []) if ((abs === r || abs?.startsWith(`${r}/`)) && (!best || r.length > best.length)) best = r;
  return best || home;
};

// Bytes → short human string. <1KB shows bytes; KB rounded; MB to 1 decimal.
const fmtSize = (n) =>
  n == null ? '' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

// The path browser. CONTROLLED on the current directory: `path` is the dir to show (null → $HOME),
// and `onNavigate(absPath)` reports every directory change up to the parent, which persists it. That
// persistence is what lets the user open a file (which swaps in a doc tab) and come back to the SAME
// directory — on remount we reload `path` instead of resetting to $HOME.
//
// The server only ever serves paths under $HOME, so the box holds a HOME-RELATIVE path behind a
// fixed `~/` prefix rendered outside the input — the home part can't be edited or deleted away.
// Two-way bound within a directory: tapping a folder rewrites the path box; typing in the box
// refetches the named dir (debounced) and live-filters its entries by the trailing fragment. Tapping
// a file (or Enter on a doc path) opens it via onOpenDoc — always an absolute path.
export default function FileBrowser({ path, onNavigate, onOpenDoc, onJumpToCwd, pendingFile, onPendingConsumed, pickMode = false, allowMkdir = !pickMode, onPick }) {
  const [input, setInput] = useState('');   // the path text box — relative to the current root
  const [dir, setDir] = useState(null);     // loaded { path, parent, entries }
  const [rootMenuOpen, setRootMenuOpen] = useState(false); // the root-prefix dropdown (~ / tmp / TMPDIR)
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');     // transient, friendly hint (not an error) — fades on its own
  const [saved, setSaved] = useState('');        // last downloaded filename — persistent box w/ "打开下载目录" (null/'' = none)
  const [confirmName, setConfirmName] = useState(null); // file awaiting download confirmation (null = no sheet)
  const [uploading, setUploading] = useState(false);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [progress, setProgress] = useState(null);       // { label, pct } during an active transfer, else null
  const fileInputRef = useRef(null);
  const loadedRef = useRef(false);          // real path of the dir currently loaded (false = none yet)
  const debounceRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const rootDdRef = useRef(null);           // root-prefix dropdown container (for outside-tap close)

  // Fetch a directory. sync=true (taps, ↑, restore) rewrites the box to the real path + trailing
  // slash; notify=true (user-driven navigation) reports the new real path so the parent persists it.
  const load = async (reqPath, { sync = false, notify = false, fallbackHome = false } = {}) => {
    setErr('');
    try {
      const d = await fetchDir(reqPath ?? undefined);
      loadedRef.current = d.path;
      setDir(d);
      if (sync) {
        // Box shows the path RELATIVE to whichever root we're in; the root itself is the dropdown prefix.
        const rel = toRel(d.path, rootOf(d.path, d.roots, d.home));
        setInput(rel ? `${rel}/` : '');
      }
      if (notify) { onNavigate?.(d.path); setMkdirOpen(false); setMkdirName(''); } // leaving this dir → drop a half-typed new-folder row
    } catch {
      if (fallbackHome && reqPath != null) { load(null, { sync: true }); return; } // seeded dir gone → $HOME
      setErr(t('filebrowser.openDirFailed'));
    }
  };

  // Load on mount and whenever the persisted `path` changes from outside (restore on remount). Our
  // own navigations set loadedRef to the same value first, so this no-ops for them (no double fetch).
  useEffect(() => {
    if (path === loadedRef.current) return;
    // sync (rewrite the box) but NOT notify: prop-driven loads (restore-on-remount, open-seed,
    // jump-to-cwd) must not report back — a notify here would let the initial null→$HOME load clobber
    // a just-seeded cwd via onNavigate, and persist $HOME over the window's real remembered dir.
    // Persistence happens only on USER navigation (enter/up/onType already pass notify:true).
    load(path, { sync: true, fallbackHome: pickMode });
  }, [path]);
  useEffect(() => () => { clearTimeout(debounceRef.current); clearTimeout(noticeTimerRef.current); }, []);
  // Close the root dropdown when a tap lands outside it (capture phase, like Dropdown.jsx).
  useEffect(() => {
    if (!rootMenuOpen) return undefined;
    const onDown = (e) => { if (!rootDdRef.current?.contains(e.target)) setRootMenuOpen(false); };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [rootMenuOpen]);

  // Friendly transient hint (e.g. unsupported preview) — distinct from the red error, fades on its own.
  const showNotice = (msg) => {
    setNotice(msg);
    clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(''), 2500);
  };

  const onType = (val) => {
    const home = dir?.home;
    if (!home) { setInput(val); return; }
    const roots = dir?.roots || [home];
    let v = val;
    if (v === '~' || v.startsWith('~/')) v = home + v.slice(1); // ~ → home absolute, folded below
    // The box is relative to a "base" root: the root an absolute path lives under (so pasting an
    // absolute path jumps roots), else the currently-shown root. Then v is made relative to it.
    let base = rootOf(dir?.path, roots, home);
    if (v.startsWith('/')) {
      base = rootOf(v, roots, home);
      v = v === base ? '' : v.startsWith(`${base}/`) ? v.slice(base.length + 1) : v.replace(/^\/+/, '');
    }
    setInput(v);
    const target = stripSlash(`${base}/${splitPath(v).dir}`); // '' dir part → the base root itself
    if (target === loadedRef.current) return; // same dir → pure client-side filter
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (target !== loadedRef.current) load(target, { notify: true });
    }, 250);
  };

  // Copy a file's absolute path to the clipboard (to paste into a terminal). On https the async
  // clipboard works inside this tap; if it's unavailable/blocked, show the path so it can be
  // long-pressed to copy by hand.
  const copyPath = async (name) => {
    const abs = joinPath(dir.path, name);
    try {
      await navigator.clipboard.writeText(abs);
      showNotice(t('filebrowser.copiedPath', { abs }));
    } catch {
      showNotice(abs);
    }
  };

  const open = (name) => onOpenDoc(joinPath(dir.path, name));
  const enter = (name) => load(joinPath(dir.path, name), { sync: true, notify: true });
  const up = () => dir?.parent && load(dir.parent, { sync: true, notify: true });
  const submitMkdir = async () => {
    const nm = mkdirName.trim();
    if (!nm || !dir) return;
    setErr('');
    try {
      await createDir(dir.path, nm);
      await load(dir.path, {}); // refresh listing so the new folder shows
      setMkdirOpen(false); setMkdirName('');
    } catch { setErr(t('filebrowser.mkdirFailed')); }
  };
  // Actual download — only reached after the user confirms in the ActionSheet (never directly from a
  // row tap), so an accidental tap can't pull a file.
  const doDownload = async (name) => {
    setErr('');
    setProgress({ label: t('filebrowser.downloading', { name }), pct: 0 });
    try {
      await downloadFile(joinPath(dir.path, name), (pct) => setProgress({ label: t('filebrowser.downloading', { name }), pct }));
      setSaved(name);
    } catch { setErr(t('filebrowser.downloadFailed')); }
    finally { setProgress(null); }
  };
  const confirmDownload = () => {
    const name = confirmName;
    setConfirmName(null);
    if (name) doDownload(name);
  };
  // The allowed roots the server reported (home + any extra roots like /tmp, $TMPDIR), and which one
  // the loaded dir currently sits in. Older servers omit `roots` → just home.
  const home = dir?.home;
  const roots = dir?.roots || (home ? [home] : []);
  const curRoot = rootOf(dir?.path, roots, home);
  // Friendly label for the root prefix: home → ~, the system temp dir → tmp, $TMPDIR → TMPDIR, else basename.
  const rootLabel = (r) =>
    r === home ? '~' : /\/tmp$/.test(r) ? 'tmp' : r.includes('/var/folders/') ? 'TMPDIR' : (r.split('/').filter(Boolean).pop() || '/');
  const goRoot = (r) => { setRootMenuOpen(false); if (r !== curRoot) load(r, { sync: true, notify: true }); };

  // Upload is allowed into a non-hidden directory below an allowed root — but never the $HOME root
  // itself (don't litter the home dir); an extra root like /tmp IS uploadable directly. Mirrors the
  // server's resolveUploadDir so the button's disabled state matches. Hidden = a segment (relative
  // to the current root) starting with '.'.
  const relHasDot = (abs, root) => {
    if (!abs || !root || abs === root) return false;
    const rel = abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : abs;
    return rel.split('/').some((s) => s.startsWith('.'));
  };
  const canUpload = !!dir && dir.path !== home && !relHasDot(dir.path, curRoot);
  // Upload one or more files into the current dir, sequentially (the server takes one file per
  // request). Accepts a single File or an array; returns the names that failed (empty = all ok).
  // With multiple files the progress label carries a (n/total) counter and a partial failure lists
  // the offenders; a single file keeps its specific server error (e.g. 文件过大).
  const doUpload = async (files) => {
    const { allowed: list, rejected } = splitUploadable(files);
    if (!list.length) {
      if (rejected.length) setErr(t('filebrowser.uploadRejected', { names: rejected.join('、') }));
      return rejected;
    }
    setUploading(true);
    setErr('');
    const total = list.length;
    const failed = [];
    for (let i = 0; i < total; i++) {
      const file = list[i];
      const tag = total > 1 ? `（${i + 1}/${total}）` : '';
      setProgress({ label: t('filebrowser.uploading', { name: file.name, tag }), pct: 0 });
      try {
        await uploadFile(dir.path, file, (pct) => setProgress({ label: t('filebrowser.uploading', { name: file.name, tag }), pct }));
      } catch (e) {
        failed.push(file.name);
        if (total === 1) setErr(e?.message || t('filebrowser.uploadFailed'));
      }
    }
    await load(dir.path, {}); // refresh listing so the new files show
    setUploading(false);
    setProgress(null);
    if (failed.length && total > 1) setErr(t('filebrowser.uploadPartialFailed', { names: failed.join('、') }));
    else if (rejected.length) setErr(t('filebrowser.uploadRejected', { names: rejected.join('、') }));
    return [...failed, ...rejected];
  };
  // A file shared in via the system share sheet (Web Share Target) → upload it to the CURRENT dir,
  // then clear it. Only clears on success, so a failure leaves it for a retry elsewhere.
  const uploadPending = async () => {
    if (pendingFile && (await doUpload(pendingFile)).length === 0) onPendingConsumed?.();
  };

  // Enter on a path that names a doc → open it directly (input is home-relative).
  const onKeyDown = (e) => {
    if (pickMode || e.key !== 'Enter') return;
    const v = input.trim();
    if (v && DOC_EXT_RE.test(v) && dir?.home) onOpenDoc(joinPath(dir.home, v));
  };

  const frag = splitPath(input).frag.toLowerCase();
  const matched = (dir?.entries || []).filter(
    (e) => (!pickMode || e.type === 'dir') && (!frag || e.name.toLowerCase().includes(frag)));
  const entries = matched.length > MAX_ROWS ? matched.slice(0, MAX_ROWS) : matched;
  const overflow = matched.length - entries.length; // >0 when the listing was capped

  return (
    <div className="browse-view">
      <div className="browse-bar">
        {onJumpToCwd && (
          <button className="browse-cwd" aria-label={t('filebrowser.sessionDir')} title={t('filebrowser.jumpToSessionDir')} onClick={onJumpToCwd}>
            <LocateIcon />
          </button>
        )}
        <button className="browse-up" aria-label={t('filebrowser.parentDir')} disabled={!dir?.parent} onClick={up}>
          <ArrowUpIcon />
        </button>
        <div className="browse-path">
          {/* The fixed root prefix. With extra roots (e.g. /tmp) it's a dropdown to switch root; the
              home "~" can't be typed away either way. The box always holds a path RELATIVE to it. */}
          {roots.length > 1 ? (
            <div className="dd browse-root-dd" ref={rootDdRef}>
              <button
                type="button" className="browse-root" aria-haspopup="listbox" aria-expanded={rootMenuOpen}
                aria-label={t('filebrowser.rootSelect')} onClick={() => setRootMenuOpen((o) => !o)}
              >
                <span>{rootLabel(curRoot)}/</span>
                <span className={`dd-caret${rootMenuOpen ? ' open' : ''}`} aria-hidden="true">▾</span>
              </button>
              {rootMenuOpen && (
                <div className="dd-menu" role="listbox">
                  {roots.map((r) => (
                    <button
                      key={r} type="button" role="option" aria-selected={r === curRoot} title={r}
                      className={`dd-option${r === curRoot ? ' is-selected' : ''}`} onClick={() => goRoot(r)}
                    >
                      <span className="dd-option-label">{rootLabel(r)}/</span>
                      {r === curRoot && <span className="dd-check" aria-hidden="true">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="browse-home" aria-hidden="true">~/</span>
          )}
          <input
            className="browse-input" value={input} placeholder={t('filebrowser.pathPlaceholder')}
            autoCapitalize="off" autoCorrect="off" spellCheck={false}
            onChange={(e) => onType(e.target.value)} onKeyDown={onKeyDown}
          />
        </div>
        {allowMkdir && (
          <button
            className="browse-mkdir" aria-label={t('filebrowser.newFolder')} title={t('filebrowser.newFolder')}
            disabled={!dir}
            onClick={() => { setMkdirOpen((v) => !v); setMkdirName(''); }}
          >
            <FolderPlusIcon />
          </button>
        )}
        {!pickMode && (
          <button
            className="browse-upload"
            aria-label={t('filebrowser.uploadFile')}
            title={canUpload ? t('filebrowser.uploadToCurrentDir') : t('filebrowser.enterSubdirToUpload')}
            disabled={!canUpload || uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadIcon />
          </button>
        )}
        {/* Off-screen (NOT hidden/display:none) so a programmatic .click() reliably opens the native
            file picker on iOS Safari — see .browse-file-input in styles.css. */}
        {!pickMode && (
          <input
            ref={fileInputRef}
            className="browse-file-input"
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            onChange={(e) => { doUpload(Array.from(e.target.files || [])); e.target.value = ''; }}
          />
        )}
      </div>
      {mkdirOpen && (
        <div className="browse-newfolder">
          <input
            className="browse-newfolder-input" autoFocus value={mkdirName}
            placeholder={t('filebrowser.folderNamePlaceholder')} autoCapitalize="off" autoCorrect="off" spellCheck={false}
            onChange={(e) => setMkdirName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitMkdir(); }}
          />
          <button className="browse-newfolder-ok" onClick={submitMkdir}>{t('filebrowser.createBtn')}</button>
          <button className="browse-newfolder-x" aria-label={t('common.cancel')} onClick={() => { setMkdirOpen(false); setMkdirName(''); }}>✕</button>
        </div>
      )}
      {!pickMode && pendingFile && (
        <div className="browse-pending">
          <span className="browse-pending-text">
            {t('filebrowser.uploadPendingTo', { name: pendingFile.name })}
            {!canUpload && <em className="browse-pending-hint">{t('filebrowser.enterSubdirFirst')}</em>}
          </span>
          <button className="browse-pending-btn" disabled={!canUpload || uploading} onClick={uploadPending}>{t('filebrowser.upload')}</button>
        </div>
      )}
      {err && <div className="bind-error browse-err">{err}</div>}
      {notice && <div className="browse-notice">{notice}</div>}
      {!pickMode && saved && (
        <div className="browse-saved">
          <span className="browse-saved-text">{t('filebrowser.savedToDownloads', { name: saved })}</span>
          <button className="browse-saved-close" aria-label={t('common.close')} onClick={() => setSaved('')}>×</button>
        </div>
      )}
      {!pickMode && progress && (
        <div className="browse-progress">
          <span className="browse-progress-label">{progress.label} {Math.round(progress.pct * 100)}%</span>
          <span className="browse-progress-track">
            <span className="browse-progress-fill" style={{ width: `${Math.round(progress.pct * 100)}%` }} />
          </span>
        </div>
      )}
      <div className="browse-list">
        {entries.length === 0 && !err && <div className="browse-empty">{t('filebrowser.noMatches')}</div>}
        {entries.map((e) => (
          <div key={e.name} className="browse-entry-row">
            <button
              className="browse-entry"
              onClick={() => (
                e.type === 'dir' ? enter(e.name)
                  : (e.type === 'doc' || e.type === 'image') ? open(e.name)
                    : showNotice(t('filebrowser.previewUnsupported'))
              )}
            >
              <span className="browse-entry-icon">{e.type === 'dir' ? <FolderIcon /> : e.type === 'image' ? <ImageIcon /> : <FileIcon />}</span>
              <span className="browse-entry-name">{e.name}</span>
              {e.type !== 'dir' && <span className="browse-entry-size">{fmtSize(e.size)}</span>}
            </button>
            {e.type !== 'dir' && (
              <button className="browse-copy" aria-label={t('filebrowser.copyAbsPath')} title={t('filebrowser.copyAbsPath')} onClick={() => copyPath(e.name)}>
                <CopyIcon />
              </button>
            )}
            {e.type !== 'dir' && (
              <button className="browse-dl" aria-label={t('filebrowser.download')} onClick={() => setConfirmName(e.name)}>
                <DownloadIcon />
              </button>
            )}
          </div>
        ))}
        {overflow > 0 && (
          <div className="browse-overflow">{t('filebrowser.tooMany', { shown: entries.length, total: matched.length })}</div>
        )}
      </div>
      {pickMode && dir && (
        <div className="browse-pick-bar">
          <button className="browse-pick-confirm" onClick={() => onPick?.(dir.path)}>
            {t('filebrowser.pickThisDir', { path: toRel(dir.path, dir.home) ? `~/${toRel(dir.path, dir.home)}` : '~' })}
          </button>
        </div>
      )}
      <ActionSheet
        open={!!confirmName}
        title={confirmName ? t('filebrowser.downloadConfirm', { name: confirmName }) : ''}
        actions={[{ key: 'dl', label: t('filebrowser.download'), onClick: confirmDownload }]}
        onClose={() => setConfirmName(null)}
      />
    </div>
  );
}
