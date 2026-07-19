import { describe, it, expect } from 'vitest';
import { previewStartError } from '../src/previewErrors.js';
import { t } from '../src/i18n';

describe('previewStartError', () => {
  it('maps stable server reasons and includes the attempted port', () => {
    expect(previewStartError({ serverError: 'port not listening' }, { port: 8443 }))
      .toBe(t('localurl.notListening', { port: 8443 }));
    expect(previewStartError({ serverError: 'bad protocol' })).toBe(t('localurl.badProtocol'));
  });

  it('keeps an unknown server reason visible instead of claiming the port is closed', () => {
    const message = previewStartError({ serverError: 'upstream policy rejected' });
    expect(message).toContain('upstream policy rejected');
    expect(message).not.toBe(t('localurl.notListening', { port: 3000 }));
  });

  it('gives network failures an actionable message', () => {
    expect(previewStartError(new TypeError('Failed to fetch'))).toBe(t('localurl.network'));
  });
});
