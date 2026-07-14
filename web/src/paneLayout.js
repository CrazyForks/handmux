// Pure geometry for the pane layout map: turn tmux pane coordinates (cells) into proportional
// percentage rects that reproduce the real split. No DOM — unit-tested. Same "extract the pure bits"
// pattern as terminalViewport.js / terminalSeed.js.

const fin = (n) => typeof n === 'number' && Number.isFinite(n);

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
