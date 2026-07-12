// Pure helpers for the command-mode keyboard's show/hide behaviour (DOM-free, unit-tested on their own).
// Good mobile terminals (Blink, Termius) keep the on-screen keyboard EXPLICIT and persistent — it is not
// dismissed by touching/scrolling the output. handmux follows that: the system keyboard is toggled only by
// the ⌨ button and a vertical drag on the dock, and a touch on the terminal keeps it up (the keepFocus
// trick). These two predicates own the fiddly decisions; the DOM wiring lives in the components.

// Decide the keyboard action from a SETTLED dock drag (dx, dy in px from the gesture origin). A
// vertical-dominant drag toggles the system keyboard — up reveals it, down dismisses it. A horizontal
// drag is the page-swipe carousel, not us. Returns 'show' | 'hide' | null (null = not a keyboard gesture).
export function keyboardSwipeAction(dx, dy, threshold = 24) {
  if (Math.abs(dy) <= Math.abs(dx)) return null; // horizontal-dominant → page swipe owns it
  if (dy <= -threshold) return 'show'; // dragged UP → pop the keyboard
  if (dy >= threshold) return 'hide';  // dragged DOWN → collapse it
  return null;                          // too short to commit
}

// iOS-style rubber-band resistance for the grabber pill's follow — UIScrollView's own curve,
// b(x) = (x·d·c) / (d + c·|x|). The pill follows at slope `c` near zero, then the marginal travel shrinks
// the further you pull: resistance is GREATEST near the end, yet it never dead-stops — it keeps creeping
// asymptotically toward (but never reaching) ±max however hard you pull. That "keeps giving, ever harder"
// is the system feel; a hard clamp (or a fast-saturating tanh) instead just stops, which reads as dead.
export function rubberBand(pull, max = 44, c = 0.5) {
  return (pull * max * c) / (max + c * Math.abs(pull));
}

// Should a touch on the TERMINAL keep the currently-focused field (and its system keyboard) up, instead
// of letting the browser blur it? True only when a real handmux text field holds focus — the command
// capture or the chat composer. xterm's own hidden helper textarea (inside .xterm) is never "the
// keyboard" (it's kept unfocusable), so a stray focus there must NOT pin anything.
export function shouldKeepKeyboard(activeEl) {
  if (!activeEl) return false;
  const tag = activeEl.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
  if (activeEl.closest && activeEl.closest('.xterm')) return false;
  return true;
}
