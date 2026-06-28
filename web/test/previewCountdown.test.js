// web/test/previewCountdown.test.js
import { describe, it, expect } from 'vitest';
import { fmtRemainMin } from '../src/previewCountdown.js';

describe('fmtRemainMin', () => {
  it('reads 60 分钟 for a fresh 1h renew, even a few hundred ms over (no 61 flash)', () => {
    expect(fmtRemainMin(3_600_000)).toBe('60 分钟');
    expect(fmtRemainMin(3_600_400)).toBe('60 分钟'); // server/device skew overshoot
    expect(fmtRemainMin(3_610_000)).toBe('60 分钟'); // up to ~30s over still rounds to 60
  });
  it('rounds to the nearest minute', () => {
    expect(fmtRemainMin(90_000)).toBe('2 分钟');   // 1.5 min → 2
    expect(fmtRemainMin(80_000)).toBe('1 分钟');   // 1.33 min → 1
  });
  it('never shows 0 分钟 while time remains; 已过期 only at/after expiry', () => {
    expect(fmtRemainMin(10_000)).toBe('1 分钟');   // <30s left → still 1, not 0
    expect(fmtRemainMin(0)).toBe('已过期');
    expect(fmtRemainMin(-5_000)).toBe('已过期');
  });
});
