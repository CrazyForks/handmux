import { describe, expect, it } from 'vitest';
import { browserLabelForOrigin, claimPublicOrigin } from '../src/browser/originLabel.js';

describe('browser proxy origin labels', () => {
  it('returns one stable 15-character DNS label per normalized Origin', () => {
    const first = browserLabelForOrigin('https://IDATA.longfor.com/path');
    expect(first).toMatch(/^b-[0-9a-z]{13}$/);
    expect(browserLabelForOrigin('https://idata.longfor.com/other')).toBe(first);
    expect(browserLabelForOrigin('https://idata.longfor.com:8443/')).not.toBe(first);
    expect(browserLabelForOrigin('http://idata.longfor.com/')).not.toBe(first);
  });

  it('matches fixed SHA-256/base36 vectors including zero padding', () => {
    // Fixed offline vectors: normalized Origin → SHA-256 first 8 bytes (big-endian) → lowercase base36 → padStart(13, '0').
    expect(browserLabelForOrigin('https://IDATA.longfor.com/path')).toBe('b-1vvys4gk1c4s3');
    expect(browserLabelForOrigin('https://example.com/path')).toBe('b-08ru5d27ceqp1');
  });

  it('fails closed when two target Origins claim one public Origin', () => {
    const claims = new Map();
    claimPublicOrigin(claims, 'https://b-fixed.preview.example', 'https://a.example');
    expect(() => claimPublicOrigin(
      claims,
      'https://b-fixed.preview.example',
      'https://b.example',
    )).toThrow('browser public origin collision');
  });
});
