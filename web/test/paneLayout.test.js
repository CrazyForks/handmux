import { describe, it, expect } from 'vitest';
import { hasGeometry, paneLayout, cellFit, MAP_W, MAP_H } from '../src/paneLayout.js';

const hsplit = [ // real tmux half-split of an 80-col window: a 1-col BORDER seam at col 40 between them
  { id: '%1', active: true,  command: 'zsh',  left: 0,  top: 0, width: 40, height: 24 },
  { id: '%2', active: false, command: 'node', left: 41, top: 0, width: 39, height: 24 },
];
const grid = [ // 2x2
  { id: '%1', active: true,  command: 'a', left: 0,  top: 0,  width: 40, height: 12 },
  { id: '%2', active: false, command: 'b', left: 40, top: 0,  width: 40, height: 12 },
  { id: '%3', active: false, command: 'c', left: 0,  top: 12, width: 40, height: 12 },
  { id: '%4', active: false, command: 'd', left: 40, top: 12, width: 40, height: 12 },
];

describe('hasGeometry', () => {
  it('true when every pane has finite left/top/width/height', () => {
    expect(hasGeometry(hsplit)).toBe(true);
  });
  it('false on empty, or when any pane is missing a coordinate', () => {
    expect(hasGeometry([])).toBe(false);
    expect(hasGeometry([{ id: '%1', width: 80, height: 24 }])).toBe(false); // no left/top
    expect(hasGeometry([{ id: '%1', left: 0, top: 0, width: 80, height: NaN }])).toBe(false);
  });
});

describe('paneLayout', () => {
  it('a real border-separated half split stays at base size — the 1-col seam is NOT bumped to the min', () => {
    const { w, h, cells } = paneLayout(hsplit);
    // The seam must NOT inflate to MIN_W and shove the right pane across / overflow the map.
    expect(w).toBe(MAP_W); // 117 (left) + 2.925 (seam, proportional) + 114.075 (right) + 14 pad = 248
    expect(h).toBe(MAP_H);
    expect(cells.map((c) => c.id)).toEqual(['%1', '%2']);
    expect(cells[0]).toMatchObject({ left: 0, top: 0, seq: 0, active: true });
    expect(cells[0].width).toBeCloseTo(117);   // (40/80) * 234
    expect(cells[1].left).toBeCloseTo(119.925); // 117 + 2.925 seam — a hairline, not a 30px gap
    expect(cells[1].width).toBeCloseTo(114.075); // (39/80) * 234
    expect(cells[0].height).toBeCloseTo(144);   // full height (158-14)
  });

  it('2x2 grid → four equal quarter tiles with the right labels', () => {
    const { cells } = paneLayout(grid);
    expect(cells).toHaveLength(4);
    expect(cells[3]).toMatchObject({ command: 'd', seq: 3 });
    expect(cells[3].left).toBeCloseTo(117);
    expect(cells[3].top).toBeCloseTo(72); // (12/24) * 144
  });

  it('a too-SHORT tile is padded to the minimum, growing the map DOWN by exactly the shortfall — siblings unchanged', () => {
    const stack = [ // top 90 rows, bottom 10 rows of a 100-row window (full width)
      { id: '%1', active: true,  command: 'vim', left: 0, top: 0,  width: 80, height: 90 },
      { id: '%2', active: false, command: 'zsh', left: 0, top: 90, width: 80, height: 10 },
    ];
    const { h, cells } = paneLayout(stack);
    // bottom would be (10/100)*144 = 14.4px → bumped to the 24px floor
    expect(cells[1].height).toBeCloseTo(24);
    // top keeps its exact proportional pixels — it is NOT shrunk to make room
    expect(cells[0].height).toBeCloseTo(129.6); // (90/100)*144
    // the whole map grew by the shortfall (24 - 14.4 = 9.6), not by scaling
    expect(h).toBeCloseTo(MAP_H + (24 - 14.4));
    expect(cells[1].top).toBeCloseTo(129.6); // sits right below the untouched top tile
  });

  it('a too-THIN tile is padded to the minimum, growing the map RIGHT — siblings unchanged', () => {
    const sidebar = [ // 90-wide main + 10-wide sidebar of a 100-col window
      { id: '%1', active: true,  command: 'node', left: 0,  top: 0, width: 90, height: 24 },
      { id: '%2', active: false, command: 'htop', left: 90, top: 0, width: 10, height: 24 },
    ];
    const { w, cells } = paneLayout(sidebar);
    expect(cells[1].width).toBeCloseTo(30);       // (10/100)*234 = 23.4 → 30 floor
    expect(cells[0].width).toBeCloseTo(210.6);    // (90/100)*234, untouched
    expect(w).toBeCloseTo(MAP_W + (30 - 23.4));   // grew right by the shortfall only
  });

  it('a full-height pane crossing the next column\'s border does NOT open a min-sized gap there', () => {
    // The screenshot bug: left pane spans the whole height; the right column splits into top/bottom with
    // a 1-row border between them. That border row is "covered" by the left pane, but it is still a seam.
    const cols = [
      { id: '%1', active: false, command: 'claude', left: 0,  top: 0,  width: 40, height: 24 }, // full height
      { id: '%2', active: false, command: 'claude', left: 41, top: 0,  width: 39, height: 12 }, // right-top
      { id: '%3', active: true,  command: 'zsh',    left: 41, top: 13, width: 39, height: 11 }, // right-bottom
    ];
    const { h, cells } = paneLayout(cols);
    const top = cells[1];
    const bot = cells[2];
    const gap = bot.top - (top.top + top.height); // the border seam between right-top and right-bottom
    expect(gap).toBeLessThan(10);   // a hairline, NOT the 24px min
    expect(h).toBe(MAP_H);          // and the map is not inflated by a phantom track
  });

  it('returns null when geometry is missing or degenerate', () => {
    expect(paneLayout([{ id: '%1', command: 'zsh' }])).toBe(null);
    expect(paneLayout([{ id: '%1', left: 0, top: 0, width: 0, height: 0 }])).toBe(null);
  });
});

describe('cellFit', () => {
  it('full content when the pixel cell is roomy in both dimensions', () => {
    expect(cellFit({ width: 117, height: 144 })).toBe('');
  });
  it("'flat' when the cell is short (can't stack seq over command)", () => {
    expect(cellFit({ width: 234, height: 20 })).toBe('flat');
  });
  it("'narrow' when the cell is thin (command can't fit horizontally)", () => {
    expect(cellFit({ width: 30, height: 144 })).toBe('narrow');
  });
  it("'tiny' when the cell is both thin and short", () => {
    expect(cellFit({ width: 30, height: 20 })).toBe('tiny');
  });
});
