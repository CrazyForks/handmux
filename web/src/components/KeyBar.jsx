import { useRef } from 'react';
import {
  FIXED_KEYS, SCROLL_KEYS, MODIFIERS, KEY_LABELS, REPEAT_KEYS, keyAction,
  MOD_LOCKED, tapMod, modActive, consumeMods, withMods,
} from '../keybarKeys.js';
import { createRepeater } from '../repeat.js';

// Two-row keyboard above the system keyboard:
//   • FIXED row (never scrolls): [命令|对话] segmented switch + 常用 button (left), then the four
//     most-used keys Esc/Tab/Ctrl/Shift (right).
//   • SCROLL row (horizontal): the arrow cluster + the mode's symbol/menu keys + Alt.
// Named keys go out via onKey (→ /keys), literals via onText (→ /send). Ctrl/Shift/Alt are sticky
// modifiers (tap = arm one key, double-tap = lock) composing the next key (C-<x> / BTab / M-<x>).
// The modifier state (`mods`) is CONTROLLED — lifted to BottomDock so the command-mode capture input
// can share it. keyAction ids come from keybarKeys.js.
export default function KeyBar({ onKey, onText, mode = 'agent', onToggleMode, onOpenFav, mods, setMods }) {
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

  const scroll = SCROLL_KEYS[mode] || SCROLL_KEYS.agent;

  return (
    <div className="keybar">
      <div className="keybar-fixed">
        <Segmented mode={mode} onToggleMode={onToggleMode} />
        <button type="button" className="keybar-fav" onClick={onOpenFav} aria-label="常用">常用</button>
        <span className="keybar-spacer" />
        {FIXED_KEYS.map((id) => MODIFIERS.includes(id)
          ? <ModKey key={id} id={id} state={mods[id]} setMods={setMods} />
          : <Key key={id} id={id} dispatch={dispatch} />)}
      </div>
      <div className="keybar-scroll">
        {scroll.map((id) => MODIFIERS.includes(id)
          ? <ModKey key={id} id={id} state={mods[id]} setMods={setMods} />
          : <Key key={id} id={id} dispatch={dispatch} />)}
      </div>
    </div>
  );
}

function Segmented({ mode, onToggleMode }) {
  const seg = (m, label) => (
    <button type="button" className={`keybar-seg-opt${mode === m ? ' on' : ''}`} data-seg={m}
      aria-pressed={mode === m} onClick={() => { if (mode !== m) onToggleMode?.(); }}>{label}</button>
  );
  return <div className="keybar-seg">{seg('command', '命令')}{seg('agent', '对话')}</div>;
}

// Sticky modifier key: single tap cycles off→armed→locked→off; a fast double-tap (<400ms) locks.
function ModKey({ id, state, setMods }) {
  const lastRef = useRef(-Infinity);
  const down = (e) => {
    if (e.cancelable) e.preventDefault();
    const now = e.timeStamp;
    const lock = now - lastRef.current < 400;
    lastRef.current = lock ? -Infinity : now;
    setMods((m) => ({ ...m, [id]: lock ? MOD_LOCKED : tapMod(m[id]) }));
  };
  const cls = state === MOD_LOCKED ? ' locked' : modActive(state) ? ' armed' : '';
  return (
    <button type="button" className={`keybar-key keybar-mod${cls}`} data-key={id} data-state={state}
      aria-pressed={modActive(state)} aria-label={KEY_LABELS[id]} onPointerDown={down}>{KEY_LABELS[id]}</button>
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
  // Held arrow repeats. Pointer events only (a tap = one pointerdown, no touch+mouse double-fire).
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
