import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { buildIatSignedUrl } from '../src/asr/iflySign.js';

const fixed = {
  appId: 'APPID123', apiKey: 'KEY456', apiSecret: 'SECRET789',
  host: 'iat-api.xfyun.cn', date: 'Wed, 14 Jun 2026 06:00:00 GMT',
};

describe('buildIatSignedUrl', () => {
  it('returns a wss url to /v2/iat with host/date/authorization query params and the appId', () => {
    const { url, appId } = buildIatSignedUrl(fixed);
    const u = new URL(url);
    expect(u.protocol).toBe('wss:');
    expect(u.host).toBe('iat-api.xfyun.cn');
    expect(u.pathname).toBe('/v2/iat');
    expect(u.searchParams.get('host')).toBe('iat-api.xfyun.cn');
    expect(u.searchParams.get('date')).toBe(fixed.date);
    expect(appId).toBe('APPID123');
    expect(u.searchParams.get('authorization')).toBeTruthy();
  });

  it('signs with HmacSHA256(signatureOrigin, apiSecret) and embeds it base64 in authorization', () => {
    const { url } = buildIatSignedUrl(fixed);
    const authB64 = new URL(url).searchParams.get('authorization');
    const auth = Buffer.from(authB64, 'base64').toString('utf8');
    const origin = `host: ${fixed.host}\ndate: ${fixed.date}\nGET /v2/iat HTTP/1.1`;
    const expectedSig = createHmac('sha256', fixed.apiSecret).update(origin).digest('base64');
    expect(auth).toContain('algorithm="hmac-sha256"');
    expect(auth).toContain('headers="host date request-line"');
    expect(auth).toContain(`api_key="${fixed.apiKey}"`);
    expect(auth).toContain(`signature="${expectedSig}"`);
  });

  it('is deterministic for the same inputs', () => {
    expect(buildIatSignedUrl(fixed).url).toBe(buildIatSignedUrl(fixed).url);
  });
});
