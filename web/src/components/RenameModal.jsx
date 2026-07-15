import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

const NAME_RE = /^[A-Za-z0-9-]{1,16}$/; // mirrors the server; rename requires a non-blank valid name

// Rename a session or a window. Prefilled with the current name; the new name must match the same
// rule as creation (≤16, letters/digits/hyphens). onSubmit(name) does the work in App and may
// throw — its message is shown inline and the button re-enables for a retry. On success App closes
// the modal (open → false).
export default function RenameModal({ open, title, currentName = '', onClose, onSubmit, inset = 0 }) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setName(currentName); setError(''); setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, currentName]);

  if (!open) return null;

  const submit = async () => {
    if (busy) return;
    const n = name.trim();
    if (!NAME_RE.test(n)) { setError(t('rename.name_rule')); return; }
    setBusy(true); setError('');
    try { await onSubmit(n); }
    catch (e) { setError(e?.message || t('rename.failed')); setBusy(false); }
  };

  return (
    <>
      <div className="settings-backdrop" onClick={onClose} />
      <div
        className="settings-card"
        style={{ transform: `translate(-50%, calc(-50% + ${inset / 2}px))` }}
        role="dialog" aria-label={title} aria-modal="true"
      >
        <div className="settings-head">
          <span className="settings-title">{title}</span>
          <button className="settings-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <div className="settings-section">
          <div className="settings-label">{t('rename.new_name')}</div>
          <input
            ref={inputRef}
            className="bind-input"
            value={name}
            placeholder={t('rename.name_rule')}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          {error && <div className="bind-error">{error}</div>}
          <div className="settings-btns bind-actions">
            <button className="fontbtn" onClick={onClose}>{t('common.cancel')}</button>
            <button className="fontbtn bind-confirm" onClick={submit} disabled={busy}>
              {busy ? t('rename.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
