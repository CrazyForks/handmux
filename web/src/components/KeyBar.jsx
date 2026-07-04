import { useRef } from 'react';
import {
  COMMAND_ROWS, MODIFIERS, KEY_LABELS, REPEAT_KEYS, keyAction,
  MOD_OFF, MOD_ARMED, MOD_LOCKED, modActive, consumeMods, withMods,
} from '../keybarKeys.js';
import { createRepeater } from '../repeat.js';
import { KeyboardIcon } from './icons.jsx';

// The command keyboard: a fixed 3×7 grid (never scrolls) with the arrows as an inverted-T in the centre
// (Esc ▲ Tab / ◀ ▼ ▶). ⌨ (top-left) toggles the system keyboard; ⌫ (top-right) and enter (bottom-right)
// are direct keys; 常用 (bottom-left) opens the favourites; Ctrl/Shift/Alt are sticky modifiers. Named
// keys go out via onKey (→ /keys), literals via onText (→ /send). `mods` is controlled (lifted to
// BottomDock so the hidden capture input can share it).
export default function KeyBar({ onKey, onText, mods, setMods, onOpenFav, onToggleKeyboard, keyboardUp }) {
  const modsRef = useRef(mods);
  modsRef.current = mods;

  const dispatch = (id) => {
    const a = keyAction(id);
    if (!a) return;
    const active = MODIFIERS.some((m) => modActive(modsRef.current[m]));
    const act = active ? withMods(a, modsRef.current) : a;
    if (act.kind === 'key') onKey(act.name); else onText(act.ch);
    if (active) setMods(consumeMods);
  };

  const cell = (id) => {
    if (id === 'kbd') {
      return (
        <button key="kbd" type="button" className={`keybar-key keybar-kbd${keyboardUp ? ' on' : ''}`}
          data-key="kbd" aria-pressed={!!keyboardUp} aria-label="键盘"
          onPointerDown={(e) => e.preventDefault()} /* keep the capture focused so a tap can dismiss it */
          onClick={onToggleKeyboard}><KeyboardIcon down={keyboardUp} /></button>
      );
    }
    if (id === 'fav') {
      return (
        <button key="fav" type="button" className="keybar-key keybar-fav" data-key="fav"
          aria-label="常用" onClick={onOpenFav}>{KEY_LABELS.fav}</button>
      );
    }
    if (MODIFIERS.includes(id)) return <ModKey key={id} id={id} state={mods[id]} setMods={setMods} />;
    return <Key key={id} id={id} dispatch={dispatch} />;
  };

  // A 7-column grid: flattening the rows keeps every column aligned, so ▲ sits directly above ▼ (the
  // inverted-T reads cleanly) and the corners land where they should.
  return <div className="keybar-grid">{COMMAND_ROWS.flat().map(cell)}</div>;
}

// Sticky modifier key. A single CLICK toggles it off ↔ armed — a swipe never fires a click, so dragging
// across the key can't arm it. A DOUBLE-CLICK locks it on. Armed and locked both light up.
function ModKey({ id, state, setMods }) {
  const toggle = () => setMods((m) => ({ ...m, [id]: modActive(m[id]) ? MOD_OFF : MOD_ARMED }));
  const lock = () => setMods((m) => ({ ...m, [id]: MOD_LOCKED }));
  const cls = state === MOD_LOCKED ? ' locked' : modActive(state) ? ' armed' : '';
  return (
    <button type="button" className={`keybar-key keybar-mod${cls}`} data-key={id} data-state={state}
      aria-pressed={modActive(state)} aria-label={KEY_LABELS[id]}
      onClick={toggle} onDoubleClick={lock}>{KEY_LABELS[id]}</button>
  );
}

function Key({ id, dispatch }) {
  const repRef = useRef(null);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch; // repeater must always call the latest dispatch (pane id changes)
  const label = KEY_LABELS[id];
  if (!REPEAT_KEYS.has(id)) {
    return <button type="button" className="keybar-key" data-key={id} onClick={() => dispatch(id)}>{label}</button>;
  }
  // Held arrow / ⌫ repeats. Pointer events only (a tap = one pointerdown, no touch+mouse double-fire).
  const start = (e) => {
    if (e.cancelable) e.preventDefault();
    if (!repRef.current) repRef.current = createRepeater(() => dispatchRef.current(id));
    repRef.current.start();
  };
  const stop = () => repRef.current?.stop();
  return (
    <button type="button" className="keybar-key" data-key={id}
      onPointerDown={start} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop}>{label}</button>
  );
}
