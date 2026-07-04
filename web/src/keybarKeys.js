// Pure key model for the mobile COMMAND keyboard (DOM-free, unit-tested on its own). Command mode shows
// a fixed 2-row grid (no horizontal scroll); the ⌨ toggle + the user's saved commands live in a separate
// quick-bar above it (BottomDock). keyAction() decides how a key is sent — a named tmux key via /keys, or
// a literal character via /send (enter:false).

// The command keyboard: a fixed 2×7 grid, never scrolls. Row 1: Esc/Tab (top-left), the two most-used
// shell symbols ~ /, and @, with ⌫ in the top-right corner. Row 2: the sticky modifiers Ctrl/Shift/Alt,
// then the arrows and Enter. The arrows form the classic inverted-T (▲ over ◀ ▼ ▶) just LEFT of Enter,
// which sits in the bottom-right corner. 'kbd' is a CONTROL id (the quick-bar's keyboard toggle), handled
// by the view, not dispatched via keyAction. All the other buried shell symbols were removed on purpose.
export const COMMAND_ROWS = [
  ['esc', 'tab', 'tilde', 'slash', 'up', 'at', 'del'],
  ['ctrl', 'shift', 'alt', 'left', 'down', 'right', 'enter'],
];

// Control ids: rendered as special buttons by the view, never dispatched as keys. ⌨ now lives in the
// quick-bar (a text button), not the grid.
export const CONTROL_KEYS = ['kbd'];

// Live modifiers rendered as sticky keys (tap = arm one key, double-tap = lock).
export const MODIFIERS = ['ctrl', 'shift', 'alt'];

export const KEY_LABELS = {
  kbd: '⌨', esc: 'Esc', up: '▲', tab: 'Tab', ctrl: 'Ctrl', shift: 'Shift', del: '⌫',
  left: '◀', down: '▼', right: '▶', alt: 'Alt', slash: '/', tilde: '~', at: '@', enter: 'Enter',
};

// Arrows and ⌫ auto-repeat while held.
export const REPEAT_KEYS = new Set(['up', 'down', 'left', 'right', 'del']);

const NAMED = {
  esc: 'Escape', tab: 'Tab', del: 'BSpace', enter: 'Enter',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
};
const CHARS = {
  slash: '/', tilde: '~', at: '@',
};

export function keyAction(id) {
  if (id in NAMED) return { kind: 'key', name: NAMED[id] };
  if (id in CHARS) return { kind: 'text', ch: CHARS[id] };
  return null; // control ids (kbd/fav) + modifiers (ctrl/shift/alt) are not dispatched as keys
}

// ── Live modifiers ────────────────────────────────────────────────────────────────────────────
// Each modifier is 'off' | 'armed' (one-shot: composes the next key then resets) | 'locked' (sticky
// until tapped off). A single tap cycles; a fast double-tap (view-side) jumps to locked.
export const MOD_OFF = 'off';
export const MOD_ARMED = 'armed';
export const MOD_LOCKED = 'locked';

export function tapMod(state) {
  if (state === MOD_ARMED) return MOD_LOCKED;
  if (state === MOD_LOCKED) return MOD_OFF;
  return MOD_ARMED;
}
export const modActive = (state) => state === MOD_ARMED || state === MOD_LOCKED;

// mods is a { ctrl, shift, alt } map of states. Any armed/locked one is active.
const anyActive = (mods) => MODIFIERS.some((m) => modActive(mods[m]));
// After a key composes: armed modifiers collapse to off, locked ones persist.
export function consumeMods(mods) {
  const out = {};
  for (const m of MODIFIERS) out[m] = mods[m] === MOD_ARMED ? MOD_OFF : (mods[m] ?? MOD_OFF);
  return out;
}

// Compose a resolved keyAction with the active modifiers into a tmux key:
//   Ctrl + letter/digit -> C-<x>;  Alt + letter/digit -> M-<x>
//   Shift + Tab -> BTab;  Shift + arrow -> S-Up/S-Down/S-Left/S-Right
// Anything else (symbols, no active modifier) passes through unchanged.
export function withMods(action, mods) {
  if (!action || !anyActive(mods)) return action;
  const ctrl = modActive(mods.ctrl), shift = modActive(mods.shift), alt = modActive(mods.alt);
  if (shift && action.kind === 'key') {
    if (action.name === 'Tab') return { kind: 'key', name: 'BTab' };
    if (['Up', 'Down', 'Left', 'Right'].includes(action.name)) return { kind: 'key', name: `S-${action.name}` };
  }
  if ((ctrl || alt) && action.kind === 'text' && /^[a-z0-9]$/i.test(action.ch)) {
    return { kind: 'key', name: `${ctrl ? 'C' : 'M'}-${action.ch.toLowerCase()}` };
  }
  return action;
}
