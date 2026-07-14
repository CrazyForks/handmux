// Pure geometry for the pane layout map: turn tmux pane coordinates (cells) into a pixel-accurate
// mosaic that reproduces the real split. No DOM — unit-tested. Same "extract the pure bits" pattern as
// terminalViewport.js / terminalSeed.js.

// Base size of the map popover (px) and its inner padding. The map GROWS from this base only additively
// (see paneLayout) — never scaled — so it can't run away on a lopsided split.
export const MAP_W = 248;
export const MAP_H = 158;
const MAP_PAD = 7;
// Below these rendered pixel sizes a cell can't legibly show its command, so content degrades:
// too NARROW → seq only; too FLAT (short) → seq + command on one row; both → seq only.
const NARROW_PX = 52;
const FLAT_PX = 34;
// The smallest a single split TRACK (a band between two adjacent split lines) may render on its axis.
// A track thinner than this is bumped up to it and the map grows OUTWARD by exactly the shortfall —
// other tracks keep their pixels, so the deficient tile reaches a tappable size without shrinking any
// sibling. Bounded: the map grows by at most (tracks × min).
const MIN_W = 30;
const MIN_H = 24;

const fin = (n) => typeof n === 'number' && Number.isFinite(n);

// True when panes is non-empty and every pane carries finite left/top/width/height, so a proportional
// map can be drawn. When false, callers fall back to the flat pane list.
export function hasGeometry(panes) {
  return Array.isArray(panes) && panes.length > 0 &&
    panes.every((p) => fin(p.left) && fin(p.top) && fin(p.width) && fin(p.height));
}

const uniqSorted = (nums) => [...new Set(nums)].sort((a, b) => a - b);

// Turn the split lines along one axis into pixel track sizes: each track is proportional to its cell
// span of the base length. A track that a PANE actually occupies is padded up to `min` when too small
// (so the axis total grows by exactly that shortfall — additive, not a scale). A track that NO pane
// covers is a BORDER SEAM (tmux separates panes by a 1-cell border, e.g. a half-split is left=0 w=40,
// right=41 w=39 with col 40 the seam) — it must stay at its hairline proportional size, never bumped to
// `min`, or a phantom ~min gap would shove the neighbour across and overflow the map. `spans` are the
// panes' [start,end] extents on this axis. Returns [{ at }] prefix offsets: a pane spanning
// edges[i]..edges[j] gets left=out[i].at, width=out[j].at-out[i].at.
function trackOffsets(edges, spans, total, baseInner, min) {
  const offsets = [{ at: 0 }];
  let acc = 0;
  for (let i = 0; i < edges.length - 1; i += 1) {
    const a = edges[i];
    const b = edges[i + 1];
    const prop = ((b - a) / total) * baseInner;
    const covered = spans.some(([s, e]) => s <= a && e >= b);
    acc += covered ? Math.max(prop, min) : prop;
    offsets.push({ at: acc });
  }
  return offsets;
}

// The map mosaic: pixel rects (not percentages) so a too-small pane can be padded to a minimum by
// growing the map outward without disturbing its siblings. Returns { w, h, cells:[{ id, active,
// command, seq, left, top, width, height }] } in px, or null when geometry is missing.
export function paneLayout(panes, opts = {}) {
  if (!hasGeometry(panes)) return null;
  const baseInnerW = (opts.baseW ?? MAP_W) - MAP_PAD * 2;
  const baseInnerH = (opts.baseH ?? MAP_H) - MAP_PAD * 2;
  const totalCols = Math.max(...panes.map((p) => p.left + p.width));
  const totalRows = Math.max(...panes.map((p) => p.top + p.height));
  if (totalCols <= 0 || totalRows <= 0) return null;

  const xs = uniqSorted(panes.flatMap((p) => [p.left, p.left + p.width]));
  const ys = uniqSorted(panes.flatMap((p) => [p.top, p.top + p.height]));
  const xSpans = panes.map((p) => [p.left, p.left + p.width]);
  const ySpans = panes.map((p) => [p.top, p.top + p.height]);
  const xOff = trackOffsets(xs, xSpans, totalCols, baseInnerW, MIN_W);
  const yOff = trackOffsets(ys, ySpans, totalRows, baseInnerH, MIN_H);
  const innerW = xOff[xOff.length - 1].at;
  const innerH = yOff[yOff.length - 1].at;

  const cells = panes.map((p, seq) => {
    const x0 = xOff[xs.indexOf(p.left)].at;
    const x1 = xOff[xs.indexOf(p.left + p.width)].at;
    const y0 = yOff[ys.indexOf(p.top)].at;
    const y1 = yOff[ys.indexOf(p.top + p.height)].at;
    return {
      id: p.id,
      active: !!p.active,
      command: p.command,
      seq,
      left: x0,
      top: y0,
      width: x1 - x0,
      height: y1 - y0,
    };
  });
  return { w: innerW + MAP_PAD * 2, h: innerH + MAP_PAD * 2, cells };
}

// Classify one pixel-sized cell (a paneLayout cell) so the component can degrade content for cramped
// cells: '' (full), 'flat' (short → seq + command on one row), 'narrow' (thin → seq only), 'tiny'.
export function cellFit(cell) {
  const narrow = cell.width < NARROW_PX;
  const flat = cell.height < FLAT_PX;
  if (narrow && flat) return 'tiny';
  if (narrow) return 'narrow';
  if (flat) return 'flat';
  return '';
}
