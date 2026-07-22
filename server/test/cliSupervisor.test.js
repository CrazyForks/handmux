import { describe, expect, it } from 'vitest';
import { browserPublicOriginEnv } from '../src/cli/supervisor.js';

describe('browser public origin supervisor environment', () => {
  it('passes previewDomain to the server process', () => {
    expect(browserPublicOriginEnv({ previewDomain: 'handmux.example.com:30443' })).toEqual({
      HANDMUX_PREVIEW_DOMAIN: 'handmux.example.com:30443',
    });
    expect(browserPublicOriginEnv({ previewDomain: null })).toEqual({});
  });
});
