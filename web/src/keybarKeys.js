// Pure key model for the mobile keyboard. The view (KeyBar.jsx) renders these ids; keyAction()
// decides how each one is sent: a named tmux key via /keys, or a literal character via /send
// (enter:false). Kept DOM-free so it unit-tests on its own.
//
// Layout is split into two zones (see KeyBar.jsx):
//   • CORE_COLS  — a FIXED cluster (inverted-T arrows with Esc/Tab in the corners) plus the Ctrl
//                  modifier key. Always visible, never scrolls/pages — muscle memory stays put.
//   • CONTEXT_PAGES[ctx] — the paged extended zone. One key set per context (shell vs coding-agent),
//                  each a list of PAGES you swipe between (snap paging, never free scroll).
// ⌫ and Enter are not modelled here — they live on the dock's right rail (BottomDock), wired straight
// to /keys (BSpace) and the text-submit path.

// The fixed core: inverted-T arrow cluster with Esc/Tab on the top corners (Esc ▲ Tab / ◀ ▼ ▶).
// Each column is a [top, bottom] pair. The Ctrl modifier key is rendered separately (it is stateful,
// not a plain dispatch — see the modifier section below).
export const CORE_COLS = [
  ['esc', 'left'],
  ['up', 'down'],
  ['tab', 'right'],
];

// The paged extended zone, per context. page = list of [top, bottom] columns; a context = list of
// pages. Swipe left/right flips whole pages (the view snaps — no half-keys, no momentum overshoot).
//   • agent — coding-agent (Claude Code / Codex / …): 1/2/3 menu picks, Shift+Tab mode-cycle, Ctrl+O,
//             then the slash-command shortcuts (type text, user submits).
//   • shell — plain shell: the symbols iOS buries (| \ ~ - _ > < & * ;), Ctrl+C/Space, Home/End, and
//             a few readline combos (the rest come from the live Ctrl modifier: Ctrl+r/w/a/u/k …).
export const CONTEXT_PAGES = {
  agent: [
    [['n1', 'slash'], ['n2', 'at'], ['n3', 'bang']],
    [['stab', 'ctrlo'], ['ctrlc', 'space'], ['compact', 'clear']],
    [['model', 'btw'], ['effort', 'plugin'], ['loop', 'skill']],
  ],
  shell: [
    [['pipe', 'tilde'], ['bslash', 'amp'], ['gt', 'lt']],
    [['dash', 'under'], ['star', 'semi'], ['ctrlc', 'space']],
    [['home', 'end'], ['stab', 'ctrll'], ['ctrlr', 'ctrle']],
  ],
};

// Modifier/control keys are spelled out (friendlier than ⇥ / ⇧⇥ / ^C glyphs).
export const KEY_LABELS = {
  esc: 'Esc', up: '▲', tab: 'Tab', left: '◀', down: '▼', right: '▶',
  home: 'Home', end: 'End',
  n1: '1', n2: '2', n3: '3', slash: '/', at: '@', space: 'Space', bang: '!',
  pipe: '|', bslash: '\\', tilde: '~', dash: '-', under: '_',
  gt: '>', lt: '<', amp: '&', star: '*', semi: ';',
  ctrlc: 'Ctrl+C', ctrll: 'Ctrl+L', ctrlo: 'Ctrl+O', ctrle: 'Ctrl+E', ctrlr: 'Ctrl+R',
  stab: 'Shift+Tab',
  // Slash-command shortcuts: the label drops the leading '/' to fit a narrow key (keyAction still
  // sends the full '/compact' etc.). The context they live in already reads as "commands".
  compact: 'compact', clear: 'clear', model: 'model', btw: 'btw',
  effort: 'effort', plugin: 'plugin', loop: 'loop', skill: 'skill',
};

// Only the arrows repeat while held (scroll/select continuously).
export const REPEAT_KEYS = new Set(['up', 'down', 'left', 'right']);

const NAMED = {
  esc: 'Escape', space: 'Space',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  tab: 'Tab', stab: 'BTab', home: 'Home', end: 'End',
  ctrlc: 'C-c', ctrll: 'C-l', ctrlo: 'C-o', ctrle: 'C-e', ctrlr: 'C-r',
};
const CHARS = {
  slash: '/', at: '@', n1: '1', n2: '2', n3: '3', bang: '!',
  pipe: '|', bslash: '\\', tilde: '~', dash: '-', under: '_',
  gt: '>', lt: '<', amp: '&', star: '*', semi: ';',
  compact: '/compact', clear: '/clear', model: '/model', btw: '/btw ',
  effort: '/effort', plugin: '/plugin', loop: '/loop ', skill: '/skill',
};

export function keyAction(id) {
  if (id in NAMED) return { kind: 'key', name: NAMED[id] };
  if (id in CHARS) return { kind: 'text', ch: CHARS[id] };
  return null;
}

// ── Ctrl live modifier ──────────────────────────────────────────────────────────────────────────
// A phone keyboard has no physical Ctrl, so the toolbar Ctrl key is a STICKY modifier applied to the
// NEXT key pressed: 'off' → tap → 'armed' (one-shot: composes the next key then auto-resets) → tap →
// 'locked' (persists across keys until tapped off) → tap → 'off'. A fast double-tap jumps to locked.
// This unlocks arbitrary readline/tmux bindings (Ctrl+r/w/a/u/k, the tmux prefix) from one key,
// instead of enumerating fixed combos.
export const CTRL_OFF = 'off';
export const CTRL_ARMED = 'armed';
export const CTRL_LOCKED = 'locked';

// One tap advances the cycle off → armed → locked → off.
export function tapCtrl(state) {
  if (state === CTRL_ARMED) return CTRL_LOCKED;
  if (state === CTRL_LOCKED) return CTRL_OFF;
  return CTRL_ARMED;
}
export const ctrlActive = (state) => state === CTRL_ARMED || state === CTRL_LOCKED;
// After a key composes with Ctrl: an armed (one-shot) modifier collapses to off; a locked one stays.
export const consumeCtrl = (state) => (state === CTRL_ARMED ? CTRL_OFF : state);

// Compose a resolved keyAction with an active Ctrl: a single letter or digit becomes the tmux combo
// C-<x> (a named key); anything else (already-named keys, multi-char slash shortcuts, symbols) is
// left untouched — Ctrl+symbol/Ctrl+slash-command has no useful terminal meaning.
export function withCtrl(action) {
  if (action && action.kind === 'text' && /^[a-z0-9]$/i.test(action.ch)) {
    return { kind: 'key', name: `C-${action.ch.toLowerCase()}` };
  }
  return action;
}
