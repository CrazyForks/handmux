import { useState } from 'react';
import { loadFavs, addFav, removeFav, moveFav, cmdScope, CMD_GLOBAL } from '../favStore.js';
import { buildChord } from '../keybarKeys.js';
import { XIcon, ChevronDownIcon } from './icons.jsx';
import { t } from '../i18n';

// Mounted only while open (BottomDock guards it), so useState seeds fresh each open. Two list sections —
// GLOBAL (grey) then THIS WINDOW (green) — over ONE shared add row. The add row has a big top tab that
// switches what you're adding: 命令 (a shell command, with a 「带回车」toggle) or 按键 (a key combo built
// from ⌃⇧⌥ + a base key → C-c). A single left switch picks which list (global / window) it lands in.
const MOD_SYM = { ctrl: '⌃', shift: '⇧', alt: '⌥' };

function List({ title, accent, items, onMove, onDel }) {
  return (
    <div className={`cmd-esection ${accent}`}>
      <div className={`cmd-section ${accent}`}><span className="cmd-section-name">{title}</span></div>
      {items.length === 0 && <div className="cmd-empty">{t('cmd.empty')}</div>}
      {items.map((f, i) => (
        <div key={f.text} className="cmd-row">
          <span className="cmd-text cmd-fav-text">
            {f.kind === 'key' ? (f.label || f.text) : f.text}
            {f.kind !== 'key' && f.enter && <span className="cmd-enter" aria-hidden="true">⏎</span>}
          </span>
          <button className="cmd-move up" disabled={i === 0} onClick={() => onMove(f.text, -1)}
            aria-label={t('cmd.moveUp')}><ChevronDownIcon /></button>
          <button className="cmd-move" disabled={i === items.length - 1} onClick={() => onMove(f.text, 1)}
            aria-label={t('cmd.moveDown')}><ChevronDownIcon /></button>
          <button className="cmd-del" onClick={() => onDel(f.text)} aria-label={t('common.delete')}><XIcon /></button>
        </div>
      ))}
    </div>
  );
}

export default function CmdFavEditor({ windowId, onClose }) {
  const winScope = windowId ? cmdScope(windowId) : null;
  const [globalItems, setGlobalItems] = useState(() => loadFavs(CMD_GLOBAL));
  const [winItems, setWinItems] = useState(() => (winScope ? loadFavs(winScope) : []));
  const [tab, setTab] = useState('cmd');            // 'cmd' | 'key' — what the add row adds
  const [scope, setScope] = useState('global');     // 'global' | 'win' — which list it lands in
  const [text, setText] = useState('');
  const [enter, setEnter] = useState(false);        // 命令: type + run (sticky across adds)
  const [mods, setMods] = useState({ ctrl: false, shift: false, alt: false }); // 按键: the chord's modifiers

  const targetScope = scope === 'win' && winScope ? winScope : CMD_GLOBAL;
  const reload = (s) => (s === CMD_GLOBAL ? setGlobalItems(loadFavs(CMD_GLOBAL)) : setWinItems(loadFavs(s)));
  const doMove = (s, txt, dir) => { moveFav(s, txt, dir); reload(s); };
  const doDel = (s, txt) => { removeFav(s, txt); reload(s); };
  const toggleMod = (m) => setMods((x) => ({ ...x, [m]: !x[m] }));

  const chord = tab === 'key' ? buildChord(mods, text) : null;
  const add = () => {
    if (tab === 'key') {
      if (!chord) return;
      addFav(targetScope, { kind: 'key', text: chord.name, label: chord.label });
      setText(''); setMods({ ctrl: false, shift: false, alt: false });
    } else {
      const v = text.trim();
      if (!v) return;
      addFav(targetScope, { kind: 'cmd', text: v, enter });
      setText('');
    }
    reload(targetScope);
  };

  return (
    <>
      <div className="cmd-backdrop" onClick={onClose} />
      <div className="cmd-panel cmd-editor" role="dialog" aria-label={t('cmd.editTitle')}>
        <div className="cmd-head">
          <span className="cmd-title">{t('cmd.editTitle')}</span>
          <button className="cmd-close" onClick={onClose} aria-label={t('common.close')}><XIcon /></button>
        </div>
        <div className="cmd-list">
          <List title={t('cmd.global')} accent="global" items={globalItems}
            onMove={(txt, d) => doMove(CMD_GLOBAL, txt, d)} onDel={(txt) => doDel(CMD_GLOBAL, txt)} />
          {winScope && <List title={t('cmd.window')} accent="win" items={winItems}
            onMove={(txt, d) => doMove(winScope, txt, d)} onDel={(txt) => doDel(winScope, txt)} />}
        </div>
        <div className="cmd-addbox">
          {/* Big top tab: what am I adding — a command, or a key combo? */}
          <div className="cmd-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'cmd'}
              className={`cmd-tab${tab === 'cmd' ? ' on' : ''}`} onClick={() => setTab('cmd')}>{t('cmd.tabCmd')}</button>
            <button type="button" role="tab" aria-selected={tab === 'key'}
              className={`cmd-tab${tab === 'key' ? ' on' : ''}`} onClick={() => setTab('key')}>{t('cmd.tabKey')}</button>
          </div>
          {/* One-line add row: [global/window switch] · [⌃⇧⌥ when 按键] · input · [带回车 when 命令] · 添加 */}
          <div className="cmd-add">
            <button type="button" className="cmd-scope-sw" onClick={() => setScope((s) => (s === 'win' ? 'global' : 'win'))}
              disabled={!winScope} aria-label={t('cmd.addTo')} data-scope={scope}>
              {scope === 'win' && winScope ? t('cmd.window') : t('cmd.global')}
            </button>
            {tab === 'key' && (
              <span className="cmd-mods">
                {['ctrl', 'shift', 'alt'].map((m) => (
                  <button key={m} type="button" className={`cmd-mod${mods[m] ? ' on' : ''}`}
                    aria-pressed={mods[m]} aria-label={m} onClick={() => toggleMod(m)}>{MOD_SYM[m]}</button>
                ))}
              </span>
            )}
            <input className="fav-add-input" value={text}
              placeholder={tab === 'key' ? t('cmd.keyPlaceholder') : t('cmd.addPlaceholder')}
              autoCapitalize="off" autoCorrect="off" spellCheck={false}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
            {tab === 'cmd' && (
              <label className="cmd-enter-opt">
                <input type="checkbox" checked={enter} onChange={(e) => setEnter(e.target.checked)} />
                {t('cmd.withEnter')}
              </label>
            )}
            {tab === 'key' && chord && <span className="cmd-chord-preview" aria-hidden="true">{chord.label}</span>}
            <button type="button" className="fav-add-btn" onClick={add}>{t('fav.add')}</button>
          </div>
        </div>
      </div>
    </>
  );
}
