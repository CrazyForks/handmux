import { useEffect, useRef, useState } from 'react';
import { getSessions, createSession, UnauthorizedError } from '../api.js';
import { getLastStartupCmd, setLastStartupCmd } from '../storage.js';
import { t } from '../i18n';
import DirPicker from './DirPicker.jsx';
import StartupCmdPicker from './StartupCmdPicker.jsx';

// Mirrors the server's isValidSessionName: letters, digits, hyphens, 1-16 chars. Applied only when
// CREATING a session — binding an existing PC-made name (which may contain spaces) checks existence
// first, so spaced names still bind.
const NEW_NAME_RE = /^[A-Za-z0-9-]{1,16}$/;

// Bind a session by name. If the name is a live session we open it (the original behavior). If it
// isn't — and it's a valid new name — the confirm button flips to "新建并打开"; a second tap creates
// the session, then opens it. A two-tap confirm so nothing is created by accident.
export default function BindSession({ open, onClose, onBound, bound, onAuthFail, inset = 0 }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('bind'); // 'bind' = check/open · 'create' = confirmed new name
  const [cwd, setCwd] = useState(null);
  const [cmd, setCmd] = useState(getLastStartupCmd()); // startup command for a newly-created session
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setName('');
      setError('');
      setBusy(false);
      setMode('bind');
      setCwd(null);
      setPickerOpen(false);
      // focus after the modal paints so the soft keyboard pops right up
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (busy) return; // one in-flight submit at a time (a double Enter must not double-create)
    const n = name.trim();
    if (!n) return;
    if (bound.includes(n)) { setError(t('bind.alreadyBound')); return; }

    // Second tap: the name is a valid, non-existent session (confirmed below) → create then open.
    if (mode === 'create') {
      setBusy(true);
      setError('');
      setLastStartupCmd(cmd); // remember the launcher for next time
      try {
        await createSession(n, cwd || undefined, cmd || undefined);
        onBound(n); // session is now live → bindSession/selectSession opens it
      } catch (e) {
        if (e instanceof UnauthorizedError) onAuthFail?.();
        // Drop back to bind mode so a retry re-checks existence: if the server actually created the
        // session before the error reached us, the next tap finds it and opens it (instead of
        // retrying create and getting stuck on a permanent 409).
        else { setMode('bind'); setError(t('bind.createFailed')); }
        setBusy(false);
      }
      return;
    }

    // First tap: does this session already exist?
    setBusy(true);
    setError('');
    try {
      const sessions = await getSessions();
      if (sessions.some((s) => s.name === n)) {
        onBound(n); // open the existing session (spaced names allowed here)
      } else if (NEW_NAME_RE.test(n)) {
        setMode('create'); // valid new name → arm the create confirm
        setBusy(false);
      } else {
        setError(t('bind.invalidName'));
        setBusy(false);
      }
    } catch (e) {
      if (e instanceof UnauthorizedError) onAuthFail?.();
      else setError(t('bind.checkFailed'));
      setBusy(false);
    }
  };

  const confirmLabel = mode === 'create'
    ? (busy ? t('bind.creating') : t('bind.createAndOpen'))
    : (busy ? t('bind.checking') : t('bind.bind'));

  return (
    <>
      <div className="settings-backdrop" onClick={onClose} />
      {/* The app slides up by `inset` when the keyboard opens; since this fixed card lives inside
          that transformed container it gets dragged up too. Add inset/2 back so the card lands
          centered in the area ABOVE the keyboard — high enough not to be covered, no higher. */}
      <div
        className="settings-card"
        style={{ transform: `translate(-50%, calc(-50% + ${inset / 2}px))` }}
        role="dialog" aria-label={t('bind.title')} aria-modal="true"
      >
        <div className="settings-head">
          <span className="settings-title">{t('bind.title')}</span>
          <button className="settings-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <div className="settings-section">
          <div className="settings-label">{t('bind.sessionName')}</div>
          <input
            ref={inputRef}
            className="bind-input"
            value={name}
            placeholder={t('bind.namePlaceholder')}
            onChange={(e) => { setName(e.target.value); setError(''); setMode('bind'); setCwd(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          {error && <div className="bind-error">{error}</div>}
          {!error && mode === 'create' && (
            <div className="bind-hint">{t('bind.createHint', { name: name.trim() })}</div>
          )}
          {mode === 'create' && (
            <>
              <div className="opt">
                <div className="settings-label">{t('bind.startDir')}</div>
                <button type="button" className="field cwd-field" onClick={() => setPickerOpen(true)}>
                  <span className="cwd-path">{cwd || t('bind.homeDirDefault')}</span>
                  <span className="cwd-action">{t('bind.choose')}</span>
                </button>
                {cwd && <button type="button" className="cwd-reset" onClick={() => setCwd(null)}>{t('bind.reset')}</button>}
              </div>
              <div className="opt">
                <StartupCmdPicker value={cmd} onChange={setCmd} />
              </div>
            </>
          )}
          <div className="settings-btns bind-actions">
            <button className="fontbtn" onClick={onClose}>{t('common.cancel')}</button>
            <button className="fontbtn bind-confirm" onClick={submit} disabled={busy}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
      <DirPicker
        open={pickerOpen}
        seedCwd={cwd}
        allowMkdir
        onPick={(p) => { setCwd(p); setPickerOpen(false); }}
        onClose={() => setPickerOpen(false)}
        inset={inset}
      />
    </>
  );
}
