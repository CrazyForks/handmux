// Pure key model for the mobile keyboard (DOM-free, unit-tested on its own). The view (KeyBar.jsx)
// renders two rows: a FIXED row (never scrolls) and a per-mode SCROLL row. keyAction() decides how a
// key is sent — a named tmux key via /keys, or a literal character via /send (enter:false).

// Fixed row, right side: the four most-used keys. Esc/Tab are direct keys; Ctrl/Shift are live
// modifiers (see below). (The mode-switch segmented control and the 常用 button render on this row's
// LEFT — they live in the view, not this table.)
export const FIXED_KEYS = ['esc', 'tab', 'ctrl', 'shift'];

// Live modifiers rendered as sticky keys. Alt sits on the scroll row; ctrl/shift on the fixed row.
export const MODIFIERS = ['ctrl', 'shift', 'alt'];

// Scroll row per mode: arrow cluster first, then the mode-relevant keys, then Alt. Horizontal scroll.
export const SCROLL_KEYS = {
  command: ['left', 'up', 'down', 'right',
    'pipe', 'bslash', 'tilde', 'dash', 'under', 'gt', 'lt', 'amp', 'semi', 'star', 'alt'],
  agent: ['left', 'up', 'down', 'right',
    'slash', 'at', 'n1', 'n2', 'n3', 'bang', 'ctrlo', 'ctrll', 'alt'],
};

export const KEY_LABELS = {
  esc: 'Esc', tab: 'Tab', ctrl: 'Ctrl', shift: '⇧', alt: 'Alt',
  up: '▲', down: '▼', left: '◀', right: '▶',
  n1: '1', n2: '2', n3: '3', slash: '/', at: '@', bang: '!',
  pipe: '|', bslash: '\\', tilde: '~', dash: '-', under: '_',
  gt: '>', lt: '<', amp: '&', star: '*', semi: ';',
  ctrlo: 'Ctrl+O', ctrll: 'Ctrl+L',
};

// Only the arrows auto-repeat while held.
export const REPEAT_KEYS = new Set(['up', 'down', 'left', 'right']);

const NAMED = {
  esc: 'Escape', tab: 'Tab',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  ctrlo: 'C-o', ctrll: 'C-l',
};
const CHARS = {
  slash: '/', at: '@', n1: '1', n2: '2', n3: '3', bang: '!',
  pipe: '|', bslash: '\\', tilde: '~', dash: '-', under: '_',
  gt: '>', lt: '<', amp: '&', star: '*', semi: ';',
};

export function keyAction(id) {
  if (id in NAMED) return { kind: 'key', name: NAMED[id] };
  if (id in CHARS) return { kind: 'text', ch: CHARS[id] };
  return null; // modifiers (ctrl/shift/alt) and unknowns are not dispatched as keys
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

// mods is a { ctrl, shift, alt } map of states. Any armed one is active (either specific test below).
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
