import { describe, it, expect } from 'vitest';
import { isTunnelConnected } from '../src/cli/sshTunnel.js';

describe('isTunnelConnected', () => {
  it('is true once an NDJSON line reports state connected', () => {
    const chunk = [
      '{"name":"handmux","state":"starting"}',
      '{"name":"handmux","state":"connected","host":"box.example.com"}',
    ].join('\n');
    expect(isTunnelConnected(chunk)).toBe(true);
  });
  it('is false for non-connected states and ignores partial/non-json lines', () => {
    expect(isTunnelConnected('{"state":"retrying"}\nplain log line\n{partial')).toBe(false);
    expect(isTunnelConnected('')).toBe(false);
    expect(isTunnelConnected(null)).toBe(false);
  });
});
