import { CHANGELOG } from '../changelog.js';
import { t, getLangCode } from '../i18n';

// "What's new" bottom sheet — a read-only list of every release (newest first). Opened from Settings;
// App marks the latest entry seen on open (clearing the unread dot). The separate pre-upgrade notice in
// Settings is intentionally compact; this sheet remains the complete historical record.
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
            // Header: "v0.9.1 · 2026-07-06" for public releases; the localized label ("早期内测") for
            // the merged internal builds, which carry no version.
            const label = rel.version ? `v${rel.version}` : (rel.label?.[getLangCode()] || rel.label?.en);
            return (
              <div key={rel.version || rel.date} className="rel">
                <div className="rel-date">
                  {label && <span className="rel-ver">{label}</span>}
                  <span className="rel-day">{rel.date}</span>
                </div>
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
