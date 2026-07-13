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

// scrollToLine target that centers `cursorLine` in a `visibleRows`-tall window, clamped to [0, baseY].
export function centerTarget(cursorLine, visibleRows, baseY) {
  return clamp(cursorLine - Math.floor(visibleRows / 2), 0, baseY);
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

// Follow-the-cursor scrollToLine target, or null to stay put. Only recenters when armed AND the cursor
// has left the visible window — so manual scrolling that keeps the cursor visible stays put, and the
// cursor is never lost once armed.
export function followTarget({ cursorLine, viewportY, visibleRows, baseY, armed }) {
  if (!armed) return null;
  const inView = cursorLine >= viewportY && cursorLine < viewportY + visibleRows;
  if (inView) return null;
  return centerTarget(cursorLine, visibleRows, baseY);
}
