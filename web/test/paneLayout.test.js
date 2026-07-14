import { describe, it, expect } from 'vitest';
import { hasGeometry, paneRects } from '../src/paneLayout.js';

const vsplit = [ // top / bottom, 80x24 window split in half vertically
  { id: '%1', active: true,  command: 'zsh',  left: 0, top: 0,  width: 80, height: 12 },
  { id: '%2', active: false, command: 'node', left: 0, top: 12, width: 80, height: 12 },
];
const hsplit = [ // left / right
  { id: '%1', active: true,  command: 'zsh',  left: 0,  top: 0, width: 40, height: 24 },
  { id: '%2', active: false, command: 'node', left: 40, top: 0, width: 40, height: 24 },
];
const grid = [ // 2x2
  { id: '%1', active: true,  command: 'a', left: 0,  top: 0,  width: 40, height: 12 },
  { id: '%2', active: false, command: 'b', left: 40, top: 0,  width: 40, height: 12 },
  { id: '%3', active: false, command: 'c', left: 0,  top: 12, width: 40, height: 12 },
  { id: '%4', active: false, command: 'd', left: 40, top: 12, width: 40, height: 12 },
];

describe('hasGeometry', () => {
  it('true when every pane has finite left/top/width/height', () => {
    expect(hasGeometry(vsplit)).toBe(true);
  });
  it('false on empty, or when any pane is missing a coordinate', () => {
    expect(hasGeometry([])).toBe(false);
    expect(hasGeometry([{ id: '%1', width: 80, height: 24 }])).toBe(false); // no left/top
    expect(hasGeometry([{ id: '%1', left: 0, top: 0, width: 80, height: NaN }])).toBe(false);
  });
});

describe('paneRects', () => {
  it('vertical split → two stacked half-height cells', () => {
    const r = paneRects(vsplit);
    expect(r.map((c) => c.id)).toEqual(['%1', '%2']);
    expect(r[0]).toMatchObject({ left: 0, top: 0,  width: 100, height: 50, seq: 0, active: true });
    expect(r[1]).toMatchObject({ left: 0, top: 50, width: 100, height: 50, seq: 1 });
  });
  it('horizontal split → two side-by-side half-width cells', () => {
    const r = paneRects(hsplit);
    expect(r[0]).toMatchObject({ left: 0,  top: 0, width: 50, height: 100 });
    expect(r[1]).toMatchObject({ left: 50, top: 0, width: 50, height: 100 });
  });
  it('2x2 grid → four quarter cells with the right command labels', () => {
    const r = paneRects(grid);
    expect(r).toHaveLength(4);
    expect(r[3]).toMatchObject({ left: 50, top: 50, width: 50, height: 50, command: 'd', seq: 3 });
  });
  it('returns [] when geometry is missing', () => {
    expect(paneRects([{ id: '%1', command: 'zsh' }])).toEqual([]);
  });
});
