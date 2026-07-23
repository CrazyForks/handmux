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
