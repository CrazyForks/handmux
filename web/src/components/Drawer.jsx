// The drawer lists only the sessions this device has bound (stored locally) — not every live
// tmux session. Binding/validation happens in the BindSession modal; here we just show the
// pinned names, let the user open or unbind one, and open the bind modal.
import { t } from '../i18n';

export default function Drawer({
  open, currentSessionName, bound, onSelectSession, onUnbind, onBind, onClose, onLogout,
}) {
  return (
    <>
      <div className={`drawer ${open ? 'open' : ''}`}>
        <div className="drawer-list">
          <div className="drawer-title">SESSIONS</div>
          {bound.length === 0 && <div className="drawer-empty">{t('drawer.empty')}</div>}
          {bound.map((name) => (
            <div
              key={name}
              className={`drawer-row drawer-session ${name === currentSessionName ? 'active' : ''}`}
            >
              <span className="drawer-name" onClick={() => onSelectSession(name)}>{name}</span>
              <button
                className="drawer-unbind"
                onClick={(e) => { e.stopPropagation(); onUnbind(name); }}
                aria-label={t('drawer.unbind')}
                title={t('drawer.unbind')}
              >✕</button>
            </div>
          ))}
          <button className="drawer-bind" onClick={onBind}>＋ {t('drawer.bind')}</button>
        </div>
        <button className="drawer-logout" onClick={onLogout}>{t('drawer.logout')}</button>
      </div>
      {open && <div className="drawer-backdrop" onClick={onClose} />}
    </>
  );
}
