import { describe, expect, it, vi } from 'vitest';
import {
  HAMMERHEAD_REBIND_HEADER,
  patchHammerheadRebindLocation,
} from '../src/browser/hammerheadRedirectCompat.js';

describe('Hammerhead rebind redirect compatibility', () => {
  it('leaves marked public bootstrap locations raw and strips the marker', () => {
    const original = vi.fn(() => 'old-session-proxy-url');
    const transforms = { location: original };
    patchHammerheadRebindLocation(transforms);
    const ctx = { destRes: { headers: { [HAMMERHEAD_REBIND_HEADER]: '1' } } };

    expect(transforms.location('https://new.preview/bootstrap', ctx))
      .toBe('https://new.preview/bootstrap');
    expect(transforms[HAMMERHEAD_REBIND_HEADER]('1', ctx)).toBeUndefined();
    expect(original).not.toHaveBeenCalled();
  });

  it('preserves normal Hammerhead redirect transformation', () => {
    const original = vi.fn(() => 'proxied-location');
    const transforms = { location: original };
    patchHammerheadRebindLocation(transforms);
    const ctx = { destRes: { headers: {} } };

    expect(transforms.location('https://target.example/', ctx)).toBe('proxied-location');
    expect(original).toHaveBeenCalledWith('https://target.example/', ctx);
  });

  it('patches a transform table only once', () => {
    const transforms = { location: vi.fn() };
    expect(patchHammerheadRebindLocation(transforms)).toBe(true);
    expect(patchHammerheadRebindLocation(transforms)).toBe(false);
  });
});
