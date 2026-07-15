import { t } from '../i18n';

function ago(ts) {
  const d = Math.max(0, Date.now() - ts);
  const m = Math.floor(d / 60000);
  if (m < 1) return t('pushInbox.justNow');
  if (m < 60) return t('pushInbox.minutesAgo').replace('{n}', m);
  const h = Math.floor(m / 60);
  if (h < 24) return t('pushInbox.hoursAgo').replace('{n}', h);
  return new Date(ts).toLocaleDateString();
}

// Full-screen manual-push inbox. Two levels driven by props: the list (open) and, layered above it,
// a single-message detail (detailId). App owns the back-button history entries (useBackButton) and the
// read-state — opening a detail is what marks that message read, via App's onOpenDetail.
export default function InboxPage({ open, detailId, items, readIds = [], onOpenDetail, onCloseDetail, onClose, onDelete }) {
  if (!open) return null;
  const readSet = new Set(readIds);

  const detail = detailId != null ? (
    <div className="push-inbox-screen push-inbox-detail-screen" role="dialog" aria-label={t('pushInbox.detailTitle')}>
      <div className="push-inbox-head">
        <button className="push-inbox-back" onClick={onCloseDetail} aria-label={t('pushInbox.back')}>‹</button>
        <span className="push-inbox-head-title">{t('pushInbox.detailTitle')}</span>
      </div>
      {(() => {
        const n = items.find((x) => x.id === detailId);
        if (!n) return <p className="push-inbox-empty">{t('pushInbox.expired')}</p>;
        return (
          <div className="push-inbox-detail-body">
            <div className="push-inbox-detail-title">{n.title}</div>
            <div className="push-inbox-detail-time">{ago(n.ts)}</div>
            <div className="push-inbox-detail-text">{n.body}</div>
            {n.url && <a className="fontbtn push-inbox-openurl" href={n.url}>{t('pushInbox.openUrl')}</a>}
            <button className="fontbtn push-inbox-detail-del" onClick={() => { onDelete(n.id); onCloseDetail(); }}>{t('pushInbox.delete')}</button>
          </div>
        );
      })()}
    </div>
  ) : null;

  return (
    <>
      <div className="push-inbox-screen" role="dialog" aria-label={t('pushInbox.title')}>
        <div className="push-inbox-head">
          <button className="push-inbox-back" onClick={onClose} aria-label={t('pushInbox.back')}>‹</button>
          <span className="push-inbox-head-title">{t('pushInbox.title')}</span>
        </div>
        {detailId == null && (items.length === 0 ? (
          <p className="push-inbox-empty">{t('pushInbox.empty')}</p>
        ) : (
          <ul className="push-inbox-list">
            {items.map((n) => (
              <li key={n.id} className={`push-inbox-row${readSet.has(n.id) ? '' : ' push-inbox-unread'}`}>
                <button className="push-inbox-main" onClick={() => onOpenDetail(n.id)}>
                  <div className="push-inbox-row-title">{n.title}</div>
                  <div className="push-inbox-row-body">{n.body}</div>
                  <div className="push-inbox-row-time">{ago(n.ts)}</div>
                </button>
                <button className="push-inbox-del" onClick={() => onDelete(n.id)} aria-label={t('pushInbox.delete')}>✕</button>
              </li>
            ))}
          </ul>
        ))}
      </div>
      {detail}
    </>
  );
}
