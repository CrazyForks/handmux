import { describe, it, expect } from 'vitest';
import { cfNamedReady } from '../src/cli/cfNamed.js';

describe('cfNamedReady', () => {
  it('is true on a real cloudflared registered-connection log line', () => {
    const line = '2026-06-20T10:00:00Z INF Registered tunnel connection connIndex=0 location=sjc01';
    expect(cfNamedReady(line)).toBe(true);
  });
  it('is false before any connection is registered', () => {
    expect(cfNamedReady('INF Starting tunnel')).toBe(false);
    expect(cfNamedReady(null)).toBe(false);
  });
});
