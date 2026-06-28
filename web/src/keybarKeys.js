// Pure key model for the mobile KeyBar. The view (KeyBar.jsx) renders these ids;
// keyAction() decides how each one is sent: a named tmux key via /keys, or a literal
// character via /send (enter:false). Kept DOM-free so it unit-tests on its own.

// The KeyBar is a horizontal strip of columns; each column is a pair of stacked keys
// [top, bottom]. SCROLL_COLS scroll left↔right together: the inverted-T arrow cluster sits
// on the left (Esc and Tab in the top corners), then the common keys, then the slash-command
// shortcuts (/compact, /model, …) which type their text for the user to submit with Enter.
// ⌫ and Enter are not modelled here — they live on the dock's right rail (BottomDock) and are
// wired straight to /keys (BSpace) and the text-submit path.
export const SCROLL_COLS = [
  ['esc', 'left'],         // ┐
  ['up', 'down'],          // ├ inverted-T: Esc ▲ Tab / ◀ ▼ ▶
  ['tab', 'right'],        // ┘
  ['n1', 'slash'],
  ['n2', 'at'],
  ['n3', 'bang'],          // 3 / !
  ['ctrlc', 'space'],      // Ctrl+C / Space
  ['compact', 'clear'],    // /compact / /clear — slash-command shortcuts (type, don't submit)
  ['model', 'btw'],        // /model / /btw (the latter types a trailing space, ready for the note)
  ['effort', 'plugin'],    // /effort / /plugin
  ['loop', 'skill'],       // /loop (types a trailing space, ready for the command) / /skill
  ['stab', 'ctrll'],       // Shift+Tab / Ctrl+L
  ['ctrlo', 'ctrle'],      // Ctrl+O / Ctrl+E
];

// Modifier/control keys are spelled out (friendlier than ⇥ / ⇧⇥ / ^C glyphs).
export const KEY_LABELS = {
  esc: 'Esc', up: '▲', tab: 'Tab',
  left: '◀', down: '▼', right: '▶',
  n1: '1', n2: '2', n3: '3', slash: '/', at: '@', space: 'Space',
  ctrlc: 'Ctrl+C', bang: '!', stab: 'Shift+Tab', ctrll: 'Ctrl+L',
  ctrlo: 'Ctrl+O', ctrle: 'Ctrl+E',
  compact: '/compact', clear: '/clear', model: '/model', btw: '/btw',
  effort: '/effort', plugin: '/plugin', loop: '/loop', skill: '/skill',
};

// Only the arrows repeat while held (scroll/select continuously).
export const REPEAT_KEYS = new Set(['up', 'down', 'left', 'right']);

const NAMED = {
  esc: 'Escape', space: 'Space',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  tab: 'Tab', stab: 'BTab', ctrlc: 'C-c', ctrll: 'C-l', ctrlo: 'C-o', ctrle: 'C-e',
};
const CHARS = {
  slash: '/', at: '@', n1: '1', n2: '2', n3: '3', bang: '!',
  compact: '/compact', clear: '/clear', model: '/model', btw: '/btw ',
  effort: '/effort', plugin: '/plugin', loop: '/loop ', skill: '/skill',
};

export function keyAction(id) {
  if (id in NAMED) return { kind: 'key', name: NAMED[id] };
  if (id in CHARS) return { kind: 'text', ch: CHARS[id] };
  return null;
}
