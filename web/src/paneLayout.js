// Pure geometry for the pane layout map: turn tmux pane coordinates (cells) into proportional
// percentage rects that reproduce the real split. No DOM — unit-tested. Same "extract the pure bits"
// pattern as terminalViewport.js / terminalSeed.js.

// Rendered size of the map popover (px). Single source of truth: the CSS `.pane-map` box matches
// these, and the component uses them both to classify each cell's fit (below) and to clamp the
// popover inside the viewport. MAP_PAD is the shell's inner padding (cells inset from the edge).
export const MAP_W = 248;
export const MAP_H = 158;
const MAP_PAD = 7;
// Below these rendered pixel sizes a cell can't legibly show its command, so content degrades:
// too NARROW → seq only; too FLAT (short) → seq + command on one row; both → seq only.
const NARROW_PX = 52;
const FLAT_PX = 34;

const fin = (n) => typeof n === 'number' && Number.isFinite(n);

// Classify one cell (a paneRects entry, width/height in percent) by its rendered pixel size inside
// the map box, so the component can degrade content for cramped cells WITHOUT changing proportions.
// Returns '' (full), 'flat', 'narrow', or 'tiny'.
export function cellFit(cell, mapW = MAP_W, mapH = MAP_H) {
  const innerW = mapW - MAP_PAD * 2;
  const innerH = mapH - MAP_PAD * 2;
  const pw = (cell.width / 100) * innerW;
  const ph = (cell.height / 100) * innerH;
  const narrow = pw < NARROW_PX;
  const flat = ph < FLAT_PX;
  if (narrow && flat) return 'tiny';
  if (narrow) return 'narrow';
  if (flat) return 'flat';
  return '';
}

// True when panes is non-empty and every pane carries finite left/top/width/height, so a proportional
// map can be drawn. When false, callers fall back to the flat pane list.
export function hasGeometry(panes) {
  return Array.isArray(panes) && panes.length > 0 &&
    panes.every((p) => fin(p.left) && fin(p.top) && fin(p.width) && fin(p.height));
}

// One rect per pane (input order), left/top/width/height as percentages of the window bounding box.
// seq = 0-based index (badge order). [] when geometry is missing.
export function paneRects(panes) {
  if (!hasGeometry(panes)) return [];
  const W = Math.max(...panes.map((p) => p.left + p.width));
  const H = Math.max(...panes.map((p) => p.top + p.height));
  if (W <= 0 || H <= 0) return [];
  return panes.map((p, seq) => ({
    id: p.id,
    active: !!p.active,
    command: p.command,
    seq,
    left: (p.left / W) * 100,
    top: (p.top / H) * 100,
    width: (p.width / W) * 100,
    height: (p.height / H) * 100,
  }));
}
