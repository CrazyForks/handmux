// Slide-up command panel: a global "常用" (favorites) section over a per-session "最近" (recent)
// section. Presentational — all state and persistence live in App/BottomDock. Tapping a row fills
// the input box (onPick, never sends); the star toggles favorite; ✕ deletes a recent entry. It's a
// fixed bottom sheet; the keyboard inset is handled by the .app transform (which carries this above
// the keyboard), so no inset prop is needed here.
import { t } from '../i18n';
import { XIcon, StarIcon } from './icons.jsx';

export default function CommandPanel({
  open, recent = [], favorites = [],
  onPick, onToggleFav, onRemoveRecent, onClose,
}) {
  if (!open) return null;
  const empty = favorites.length === 0 && recent.length === 0;
  return (
    <>
      <div className="cmd-backdrop" onClick={onClose} />
      <div className="cmd-panel" role="dialog" aria-label={t('cmd.panel')}>
        <div className="cmd-head">
          <span className="cmd-title">{t('cmd.title')}</span>
          <button className="cmd-close" onClick={onClose} aria-label={t('common.close')}><XIcon /></button>
        </div>
        <div className="cmd-list">
          {empty && <div className="cmd-empty">{t('cmd.empty')}</div>}
          {favorites.length > 0 && (
            <div className="cmd-section fav">
              <span className="cmd-section-name">{t('cmd.favorites')}</span>
              <span className="cmd-scope">{t('cmd.scopeGlobal')}</span>
            </div>
          )}
          {favorites.map((cmd) => (
            <div key={`f:${cmd}`} className="cmd-row">
              <span className="cmd-text" onClick={() => onPick(cmd)}>{cmd}</span>
              <button className="cmd-star on" onClick={() => onToggleFav(cmd)} aria-label={t('cmd.unfavorite')}><StarIcon /></button>
            </div>
          ))}
          {recent.length > 0 && (
            <div className="cmd-section recent">
              <span className="cmd-section-name">{t('cmd.recent')}</span>
              <span className="cmd-scope">{t('cmd.scopeSession')}</span>
            </div>
          )}
          {recent.map((cmd) => {
            const fav = favorites.includes(cmd);
            return (
              <div key={`r:${cmd}`} className="cmd-row">
                <span className="cmd-text" onClick={() => onPick(cmd)}>{cmd}</span>
                <button className={`cmd-star ${fav ? 'on' : ''}`} onClick={() => onToggleFav(cmd)}
                  aria-label={fav ? t('cmd.unfavorite') : t('cmd.favorite')}><StarIcon /></button>
                <button className="cmd-del" onClick={() => onRemoveRecent(cmd)} aria-label={t('common.delete')}><XIcon /></button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
