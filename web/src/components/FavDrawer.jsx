import { useRef, useState } from 'react';
import { loadFavs, addFav, removeFav } from '../favStore.js';
import { XIcon } from './icons.jsx';
import { t } from '../i18n';

// Bottom drawer of 常用 items for the current mode. Reply items (agent mode) render as chips; command
// items render as rows. Tap = send (onSend), double-tap = fill (onFill). Users add/delete their own.
export default function FavDrawer({ open, mode, recent = [], onSend, onFill, onClose }) {
  const [items, setItems] = useState(() => loadFavs(mode));
  // Uncontrolled adder: read the field via a ref so the value survives a raw programmatic set (React's
  // controlled value-tracker would otherwise swallow synthetic input events).
  const inputRef = useRef(null);
  // Reload when the mode changes (drawer is remounted per open in BottomDock, but guard anyway).
  const [seenMode, setSeenMode] = useState(mode);
  if (seenMode !== mode) { setSeenMode(mode); setItems(loadFavs(mode)); }
  if (!open) return null;

  const replies = items.filter((f) => f.kind === 'reply');
  const cmds = items.filter((f) => f.kind === 'cmd');
  const add = () => {
    const text = (inputRef.current?.value || '').trim();
    if (!text) return;
    const kind = mode === 'agent' && !text.startsWith('/') ? 'reply' : 'cmd';
    setItems(addFav(mode, { kind, text }));
    if (inputRef.current) inputRef.current.value = '';
  };
  const del = (text) => setItems(removeFav(mode, text));

  return (
    <>
      <div className="cmd-backdrop" onClick={onClose} />
      <div className="cmd-panel" role="dialog" aria-label={t('fav.title')}>
        <div className="cmd-head">
          <span className="cmd-title">{t('fav.title')}</span>
          <button className="cmd-close" onClick={onClose} aria-label={t('common.close')}><XIcon /></button>
        </div>
        <div className="cmd-list">
          {replies.length > 0 && (
            <div className="fav-chips">
              {replies.map((f) => (
                <span key={f.text} className="fav-chip"
                  onClick={() => onSend(f.text)} onContextMenu={(e) => { e.preventDefault(); del(f.text); }}>{f.text}</span>
              ))}
            </div>
          )}
          {cmds.map((f) => (
            <div key={f.text} className="cmd-row">
              <span className="cmd-text" onClick={() => onSend(f.text)} onDoubleClick={() => onFill(f.text)}>{f.text}</span>
              <button className="cmd-del" onClick={() => del(f.text)} aria-label={t('common.delete')}><XIcon /></button>
            </div>
          ))}
          {recent.map((cmd) => (
            <div key={`r:${cmd}`} className="cmd-row">
              <span className="cmd-text" onClick={() => onSend(cmd)} onDoubleClick={() => onFill(cmd)}>{cmd}</span>
            </div>
          ))}
          <div className="fav-add">
            <input ref={inputRef} className="fav-add-input" placeholder={t('fav.addPlaceholder')}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
            <button className="fav-add-btn" onClick={add}>{t('fav.add')}</button>
          </div>
        </div>
      </div>
    </>
  );
}
