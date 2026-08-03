import { describe, expect, it } from 'vitest';
import {
  applySiteVersionHeaders,
  normalizeSiteVersion,
  siteVersionIdentity,
  siteVersionNavigatorScript,
} from '../src/browser/siteVersion.js';

const MOBILE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

describe('browser requested site version', () => {
  it('accepts only the two user-facing versions and defaults old clients to mobile', () => {
    expect(normalizeSiteVersion(undefined)).toBe('mobile');
    expect(normalizeSiteVersion('mobile')).toBe('mobile');
    expect(normalizeSiteVersion('desktop')).toBe('desktop');
    expect(normalizeSiteVersion('tablet')).toBeNull();
  });

  it('keeps matching browser families and converts mismatched mobile/desktop identities', () => {
    expect(siteVersionIdentity('mobile', MOBILE_SAFARI).userAgent).toBe(MOBILE_SAFARI);
    const desktopSafari = siteVersionIdentity('desktop', MOBILE_SAFARI);
    expect(desktopSafari.userAgent).toContain('Macintosh');
    expect(desktopSafari.userAgent).not.toContain('Mobile/');
    const mobileChrome = siteVersionIdentity('mobile', DESKTOP_CHROME);
    expect(mobileChrome.userAgent).toContain('Android');
    expect(mobileChrome.userAgent).toContain('Mobile Safari');
  });

  it('keeps network headers and page-visible navigator identity consistent', () => {
    const identity = siteVersionIdentity('mobile', DESKTOP_CHROME);
    const headers = {
      'User-Agent': DESKTOP_CHROME,
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Linux"',
      'Sec-CH-UA-Model': '"Desktop"',
    };
    applySiteVersionHeaders(headers, identity);

    expect(headers['User-Agent']).toBe(identity.userAgent);
    expect(headers['Sec-CH-UA-Mobile']).toBe('?1');
    expect(headers['Sec-CH-UA-Platform']).toBe('"Android"');
    expect(headers).not.toHaveProperty('Sec-CH-UA-Model');
    const script = siteVersionNavigatorScript(identity);
    expect(script).toContain("define('userAgent', profile.userAgent)");
    expect(script).toContain("define('userAgentData', data)");
  });
});
