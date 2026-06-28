import { describe, it, expect } from 'vitest';
import { probe } from '../src/cli/probe.js';

describe('probe', () => {
  it('reachable when the GET resolves', async () => {
    expect(await probe('https://x.dev', { fetchImpl: async () => ({}) })).toBe(true);
  });
  it('unreachable when the GET rejects or times out', async () => {
    expect(await probe('https://x.dev', { fetchImpl: async () => { throw new Error('refused'); } })).toBe(false);
  });
  it('returns false for an empty url', async () => {
    expect(await probe('', { fetchImpl: async () => ({}) })).toBe(false);
  });
});
