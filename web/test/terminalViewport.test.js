import { describe, it, expect } from 'vitest';
import {
  fitRows, scrollDecision, centerTarget, bottomTarget, cursorBufferLine, bottomPadRows, followTarget,
} from '../src/terminalViewport.js';

describe('fitRows', () => {
  it('floors available/cellH, min 1', () => {
    expect(fitRows(300, 20)).toBe(15);
    expect(fitRows(10, 20)).toBe(1);
    expect(fitRows(300, 0)).toBe(1);
  });
});

describe('scrollDecision', () => {
  it('up: internal while above top, else forward', () => {
    expect(scrollDecision(5, 20, -1)).toBe('internal');
    expect(scrollDecision(0, 20, -1)).toBe('forward');
  });
  it('down: internal while below bottom, else forward', () => {
    expect(scrollDecision(5, 20, 1)).toBe('internal');
    expect(scrollDecision(20, 20, 1)).toBe('forward');
  });
});

describe('centerTarget', () => {
  it('centers the cursor line, clamped to [0, baseY]', () => {
    expect(centerTarget(50, 20, 100)).toBe(40); // 50 - 10
    expect(centerTarget(5, 20, 100)).toBe(0);   // clamp low
    expect(centerTarget(99, 20, 100)).toBe(89);
    expect(centerTarget(200, 20, 100)).toBe(100); // clamp high
  });
});

describe('cursorBufferLine', () => {
  it('counts up from the content bottom; null when hidden', () => {
    expect(cursorBufferLine({ row: 0, col: 0, vis: true }, 30)).toBe(29);
    expect(cursorBufferLine({ row: 5, col: 0, vis: true }, 30)).toBe(24);
    expect(cursorBufferLine({ row: 0, col: 0, vis: false }, 30)).toBe(null);
    expect(cursorBufferLine(null, 30)).toBe(null);
  });
});

describe('bottomPadRows', () => {
  it('rows to prepend so content sits at the grid bottom', () => {
    expect(bottomPadRows(6, 15)).toBe(9);
    expect(bottomPadRows(20, 15)).toBe(0);
  });
});

describe('followTarget', () => {
  const base = { visibleRows: 20, baseY: 100 };
  it('null when not armed', () => {
    expect(followTarget({ cursorLine: 90, viewportY: 0, armed: false, ...base })).toBe(null);
  });
  it('null when cursor already in the visible window', () => {
    expect(followTarget({ cursorLine: 10, viewportY: 0, armed: true, ...base })).toBe(null);
  });
  it('bottom-aligns the cursor when armed and out of view (last visible row = cursor)', () => {
    expect(followTarget({ cursorLine: 90, viewportY: 0, armed: true, ...base })).toBe(71); // 90 - 20 + 1
  });
  it('clamps the bottom-align target to [0, baseY]', () => {
    expect(followTarget({ cursorLine: 5, viewportY: 60, armed: true, ...base })).toBe(0);   // above view → clamp low
    expect(followTarget({ cursorLine: 200, viewportY: 0, armed: true, ...base })).toBe(100); // clamp high
  });
});

describe('bottomTarget', () => {
  it('puts the cursor on the bottom visible row, clamped to [0, baseY]', () => {
    expect(bottomTarget(90, 20, 100)).toBe(71); // 90 - 20 + 1
    expect(bottomTarget(5, 20, 100)).toBe(0);   // clamp low
    expect(bottomTarget(200, 20, 100)).toBe(100); // clamp high
  });
});
