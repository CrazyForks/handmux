// Pure key model for the mobile COMMAND keyboard (DOM-free, unit-tested on its own). Command mode shows
// a fixed 3-row grid (no horizontal scroll); agent/chat mode has no keybar at all. keyAction() decides
// how a key is sent — a named tmux key via /keys, or a literal character via /send (enter:false).

// The command keyboard: a fixed 3×7 grid, never scrolls. The arrows form the classic inverted-T at the
// BOTTOM-RIGHT (▲ over ◀ ▼ ▶). Corners: ⌨ keyboard-toggle (top-left), ⌫ (top-right), 常用 (bottom-left);
// Enter sits at the right edge of the middle row. 'kbd' and 'fav' are CONTROL ids handled by the view
// (KeyBar), not dispatched via keyAction. ctrl/shift/alt are live modifiers.
export const COMMAND_ROWS = [
  ['kbd', 'esc', 'tab', 'pipe', 'slash', 'tilde', 'del'],
  ['ctrl', 'shift', 'alt', 'dash', 'under', 'up', 'enter'],
  ['fav', 'bslash', 'gt', 'lt', 'left', 'down', 'right'],
];

// Control ids: rendered as special buttons by the view, never dispatched as keys.
export const CONTROL_KEYS = ['kbd', 'fav'];

// Live modifiers rendered as sticky keys (tap = arm one key, double-tap = lock).
export const MODIFIERS = ['ctrl', 'shift', 'alt'];

export const KEY_LABELS = {
  kbd: '⌨', esc: 'Esc', up: '▲', tab: 'Tab', ctrl: 'Ctrl', shift: 'Shift', del: '⌫',
  pipe: '|', left: '◀', down: '▼', right: '▶', alt: 'Alt', slash: '/', tilde: '~',
  fav: '常用', dash: '-', under: '_', bslash: '\\', gt: '>', lt: '<', enter: 'Enter',
};

// Arrows and ⌫ auto-repeat while held.
export const REPEAT_KEYS = new Set(['up', 'down', 'left', 'right', 'del']);

const NAMED = {
  esc: 'Escape', tab: 'Tab', del: 'BSpace', enter: 'Enter',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
};
const CHARS = {
  pipe: '|', slash: '/', tilde: '~', dash: '-', under: '_', bslash: '\\', gt: '>', lt: '<',
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
