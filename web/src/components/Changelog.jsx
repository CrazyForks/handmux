import { CHANGELOG } from '../changelog.js';
import { t, getLangCode } from '../i18n';

// "What's new" bottom sheet — a read-only list of releases (newest first). Opened from Settings; App
// marks the latest entry seen on open (clearing the unread dot). Reuses the command-panel sheet chrome.
export default function Changelog({ open, onClose }) {
  if (!open) return null;
  return (
    <>
      <div className="cmd-backdrop" onClick={onClose} />
      <div className="changelog-panel" role="dialog" aria-label={t('changelog.title')}>
        <div className="cmd-head">
          <span className="cmd-title">{t('changelog.title')}</span>
          <button className="cmd-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <div className="changelog-list">
          {CHANGELOG.map((rel) => {
            // items is { zh, en }; fall back across locales so a partly-translated entry still shows.
            const items = rel.items[getLangCode()] || rel.items.en || rel.items.zh || [];
            return (
              <div key={rel.v} className="rel">
                <div className="rel-date">{rel.date}</div>
                <ul className="rel-items">
                  {items.map((it, i) => <li key={i}>{it}</li>)}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
