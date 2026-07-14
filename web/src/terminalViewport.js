// Pure viewport/scroll geometry for the terminal keyboard-fit + alt-screen scroll features. No DOM —
// unit-tested; see terminalSeed.js / terminalSelection.js for the same "extract the pure bits" pattern.

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Rows that fit `availPx` of height at cell height `cellH`. Floor so the grid never exceeds the box.
export function fitRows(availPx, cellH) {
  if (!cellH || cellH <= 0) return 1;
  return Math.max(1, Math.floor(availPx / cellH));
}

// Should a vertical drag scroll the terminal INTERNALLY (xterm viewport) or FORWARD to the app as keys?
// dir: -1 = drag content up (reveal earlier rows), +1 = drag content down (reveal later rows).
export function scrollDecision(viewportY, baseY, dir) {
  if (dir < 0) return viewportY > 0 ? 'internal' : 'forward';
  return viewportY < baseY ? 'internal' : 'forward';
}

// scrollToLine target that puts `cursorLine` on the FIRST (top) visible row, clamped to [0, baseY].
export function topTarget(cursorLine, baseY) {
  return clamp(cursorLine, 0, baseY);
}

// scrollToLine target that puts `cursorLine` on the BOTTOM visible row, clamped to [0, baseY].
export function bottomTarget(cursorLine, visibleRows, baseY) {
  return clamp(cursorLine - visibleRows + 1, 0, baseY);
}

// Absolute buffer line of the cursor. cur.row counts UP from the content's bottom row (see cursorSeq).
export function cursorBufferLine(cur, seedRows) {
  if (!cur || !cur.vis) return null;
  return Math.max(0, (seedRows - 1) - Math.max(0, cur.row | 0));
}

// Blank rows to prepend so `contentRows` of content sits flush at the bottom of a `gridRows`-tall grid.
export function bottomPadRows(contentRows, gridRows) {
  return Math.max(0, gridRows - contentRows);
}

// Follow-the-cursor scrollToLine target, or null to stay put — the editor "scroll into view" rule: scroll
// the minimum to the NEAREST edge the cursor left by. Above the window → put it on the first row (top-align);
// below → on the last row (bottom-align); still in view → don't move. Only acts when armed.
export function followTarget({ cursorLine, viewportY, visibleRows, baseY, armed }) {
  if (!armed) return null;
  if (cursorLine < viewportY) return topTarget(cursorLine, baseY);                 // above → first row = cursor
  if (cursorLine >= viewportY + visibleRows) return bottomTarget(cursorLine, visibleRows, baseY); // below → last row = cursor
  return null; // in view → stay
}
