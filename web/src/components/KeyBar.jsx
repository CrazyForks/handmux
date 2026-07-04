import { useRef } from 'react';
import {
  COMMAND_ROWS, MODIFIERS, KEY_LABELS, REPEAT_KEYS, keyAction,
  MOD_OFF, MOD_ARMED, MOD_LOCKED, modActive, consumeMods, withMods,
} from '../keybarKeys.js';
import { createRepeater } from '../repeat.js';

// In command mode the hidden capture <input> holds the system keyboard open. A <button> tap would move
// focus to itself → the capture blurs → the keyboard collapses (so you couldn't tap Ctrl then a letter
// on the system keyboard). preventDefault on pointer-down keeps focus on the capture; onClick still fires.
const keepFocus = (e) => { if (e.cancelable) e.preventDefault(); };

// The command keyboard: a fixed 2×7 grid (never scrolls). Row 1: Esc/Tab, the ~ / @ symbols and ⌫;
// row 2: the sticky Ctrl/Shift/Alt modifiers, then the inverted-T arrows (▲ over ◀ ▼ ▶) left of Enter.
// The ⌨ keyboard-toggle and the user's saved commands live in the quick-bar ABOVE this grid (BottomDock).
// Named keys go out via onKey (→ /keys), literals via onText (→ /send). `mods` is controlled (lifted to
// BottomDock so the hidden capture input can share it).
export default function KeyBar({ onKey, onText, mods, setMods }) {
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
      onPointerDown={keepFocus} onClick={toggle} onDoubleClick={lock}>{KEY_LABELS[id]}</button>
  );
}

function Key({ id, dispatch }) {
  const repRef = useRef(null);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch; // repeater must always call the latest dispatch (pane id changes)
  const gRef = useRef(null);      // in-flight gesture: { x, y, guard, held, moved }
  const label = KEY_LABELS[id];
  if (!REPEAT_KEYS.has(id)) {
    // Fires on CLICK (release), never on touch-down — a left/right page swipe that starts on the key
    // moves off and cancels the click, so dragging across never triggers it. keepFocus keeps the system
    // keyboard open (tapping this key mustn't blur the capture input).
    return <button type="button" className="keybar-key" data-key={id}
      onPointerDown={keepFocus} onClick={() => dispatch(id)}>{label}</button>;
  }
  // Held arrow / ⌫ auto-repeats — but a page swipe can start on a key too, so we must NOT fire on
  // touch-down. A short guard disambiguates: hold still past it → the repeater kicks in (first press +
  // repeat); release before it → one press (a tap); move the finger (a swipe) → cancel, no press.
  const clearGuard = () => { const g = gRef.current; if (g?.guard) { clearTimeout(g.guard); g.guard = null; } };
  const down = (e) => {
    if (e.cancelable) e.preventDefault();
    if (!repRef.current) repRef.current = createRepeater(() => dispatchRef.current(id));
    const g = { x: e.clientX, y: e.clientY, held: false, moved: false, guard: null };
    g.guard = setTimeout(() => { g.held = true; g.guard = null; repRef.current.start(); }, 140);
    gRef.current = g;
  };
  const move = (e) => {
    const g = gRef.current;
    if (!g || g.held) return; // once repeating we've committed to a press; a later drift doesn't matter
    if (Math.abs(e.clientX - g.x) > 8 || Math.abs(e.clientY - g.y) > 8) { g.moved = true; clearGuard(); }
  };
  const up = () => {
    const g = gRef.current;
    if (!g) return;
    clearGuard();
    if (g.held) repRef.current.stop();          // was repeating → stop
    else if (!g.moved) dispatchRef.current(id); // quick tap, never moved → one press
    gRef.current = null;
  };
  const cancel = () => {
    clearGuard();
    if (gRef.current?.held) repRef.current.stop();
    gRef.current = null; // swipe / leave / cancel → no press
  };
  return (
    <button type="button" className="keybar-key" data-key={id}
      onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerCancel={cancel} onPointerLeave={cancel}>{label}</button>
  );
}
